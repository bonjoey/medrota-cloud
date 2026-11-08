"""
FR-AI01 — Intelligent Shift Scheduling Engine (CP-SAT Solver)

หลักการสำคัญตาม PRD หัวข้อ 5.4.3:
  1. รับประกันความถูกต้อง — ไม่คืนคำตอบที่ละเมิด Hard Constraint เด็ดขาด
  2. ทุกการมอบหมายต้องอธิบายได้ (AIP-01)
  3. กรณี Infeasible ต้องระบุชุดเงื่อนไขที่ขัดแย้งกัน ไม่ใช่แค่ "จัดเวรไม่ได้"

หมายเหตุสำคัญ (ADR-0002): Constraint Model นี้เป็นโมเดลเดียวกันที่ FR-A10
(Conflict Check ใน MVP 1) ต้องใช้ตรวจตารางที่มนุษย์แก้มือด้วย — ห้ามมีตรรกะกฎ
สองชุดที่อาจขัดกันเอง ดู `check_conflicts()` ที่ reuse HardConstraintBuilder เดียวกัน
"""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, timedelta

from ortools.sat.python import cp_model

from app.schemas import (
    AssignmentExplanation,
    ConflictCheckAssignment,
    ConflictCheckRequest,
    ConflictCheckResult,
    ConflictLocation,
    ConflictViolation,
    InfeasibleReason,
    QualityScore,
    ScheduleSuggestRequest,
    ScheduleSuggestResult,
)

# MVP 2 Sprint 6: รายชื่อ Soft Constraint ที่โมเดลเป็น Objective Function จริงแล้ว
# (ต้องตรงกับ apps/api/src/common/constants/rule-keys.ts::SOFT_RULE_KEYS)
# PERSONAL_PREFERENCE ยังไม่มี Input ความต้องการส่วนบุคคลจริงจนกว่าจะถึง Sprint 21
# (ส่วนขยาย) จึงรับ ruleKey นี้ได้แต่ยังไม่มีผลต่อ Objective ในชั้นนี้
MODELED_SOFT_RULE_KEYS = {"NIGHT_SHIFT_FAIRNESS", "HOLIDAY_SHIFT_FAIRNESS", "SHIFT_PATTERN_CONTINUITY"}


def shift_hours(meta: dict) -> float:
    """คำนวณชั่วโมงของเวร 1 เวรจาก startTime/endTime (รองรับเวรข้ามเที่ยงคืน)
    — ตรรกะเดียวกับ apps/api/src/common/utils/shift-time.util.ts::computeShiftHours
    ต้องตรงกันเป๊ะ ๆ เพราะทั้งสองฝั่งคำนวณชั่วโมงทำงานจากข้อมูลเดียวกัน"""
    start_h, start_m = (int(p) for p in meta["startTime"].split(":"))
    end_h, end_m = (int(p) for p in meta["endTime"].split(":"))
    start_minutes = start_h * 60 + start_m
    end_minutes = end_h * 60 + end_m
    if meta.get("crossesMidnight") or end_minutes <= start_minutes:
        end_minutes += 24 * 60
    return (end_minutes - start_minutes) / 60


class HardConstraintBuilder:
    """
    สร้าง Hard Constraint ทั้งหมดบน CP-SAT model พร้อมผูก Assumption Literal
    ต่อกฎแต่ละข้อ เพื่อให้วินิจฉัย Infeasibility ได้ว่าขัดกันที่กฎใด
    (ortools รองรับผ่าน AddAssumptions + SufficientAssumptionsForInfeasibility)
    """

    def __init__(self, model: cp_model.CpModel, request: ScheduleSuggestRequest):
        self.model = model
        self.request = request
        self.days = self._month_days(request.year, request.month)
        self.users = [s.user_id for s in request.staff]
        self.user_level = {s.user_id: s.position_level for s in request.staff}
        self.shift_codes = [s["code"] for s in request.shift_types]
        self.shift_by_code = {s["code"]: s for s in request.shift_types}

        # x[(user, day, shift)] = 1 ถ้ามอบหมายเวรนั้น
        self.x: dict[tuple[str, date, str], cp_model.IntVar] = {}
        for u in self.users:
            for d in self.days:
                for sc in self.shift_codes:
                    self.x[(u, d, sc)] = model.NewBoolVar(f"x_{u}_{d}_{sc}")

        # Assumption literals: assumption_lit -> (rule_key, human explanation)
        self.assumptions: dict[cp_model.IntVar, tuple[str, str]] = {}

        # MVP 2 Sprint 8: Incremental Re-solve — วันนอก resolve_window ถูกตรึงตาม
        # fixed_assignments ทั้งหมด (ทั้งที่มีเวรและวันว่าง) ส่วนในหน้าต่างปล่อยให้ Solver
        # ค้นหาใหม่ได้เต็มที่ตามปกติ
        self.resolve_window = request.resolve_window
        self.fixed_by_user_date: dict[tuple[str, date], str] = {
            (fa.user_id, fa.date): fa.shift_type_code for fa in request.fixed_assignments
        }

    def _in_resolve_window(self, d: date) -> bool:
        """คืนค่า True ถ้าวันนี้เป็นวันที่ Solver ค้นหาใหม่ได้ (ไม่ได้ถูกตรึง)
        ถ้าไม่มี resolve_window เลย = จัดใหม่ทั้งเดือน ทุกวันถือเป็น "ในหน้าต่าง" """
        if self.resolve_window is None:
            return True
        return self.resolve_window.start_date <= d <= self.resolve_window.end_date

    def add_fixed_assignment_pins(self) -> None:
        """Hard: ตรึงเวรทุกวันนอก resolve_window ให้ตรงกับตารางเดิมเป๊ะ ๆ (Sprint 8)
        ผูกผ่าน Assumption Literal เหมือน Hard Constraint อื่นทุกตัว (ไม่ใช้ model.Add ตรง ๆ)
        เพื่อให้ SufficientAssumptionsForInfeasibility() วินิจฉัยได้ว่า "ตารางเดิมที่ตรึงไว้"
        เป็นสาเหตุของ Infeasible หรือไม่ — ตรงตาม AIP-01 ที่ต้องระบุเหตุผลได้ 100% แม้ในโหมด
        Incremental Re-solve ซึ่งมีเงื่อนไขพิเศษเพิ่มจากโหมดจัดใหม่ทั้งเดือนปกติ"""
        if self.resolve_window is None:
            return
        for u in self.users:
            for d in self.days:
                if self._in_resolve_window(d):
                    continue
                fixed_code = self.fixed_by_user_date.get((u, d))
                lit = self._assume(
                    "FIXED_ASSIGNMENT_PIN",
                    f"{u} มีเวรเดิม '{fixed_code or 'วันว่าง'}' ที่ถูกตรึงไว้ในวันที่ {d.isoformat()} "
                    "(อยู่นอกช่วงที่ให้ Solver จัดใหม่)",
                )
                for sc in self.shift_codes:
                    self.model.Add(self.x[(u, d, sc)] == (1 if sc == fixed_code else 0)).OnlyEnforceIf(lit)

    @staticmethod
    def _month_days(year: int, month: int) -> list[date]:
        d = date(year, month, 1)
        days = []
        while d.month == month:
            days.append(d)
            d += timedelta(days=1)
        return days

    def _assume(self, rule_key: str, explanation: str) -> cp_model.IntVar:
        lit = self.model.NewBoolVar(f"assume_{rule_key}_{len(self.assumptions)}")
        self.assumptions[lit] = (rule_key, explanation)
        return lit

    def add_no_double_booking(self) -> None:
        """Hard: ห้ามมอบหมายเวรซ้อนทับในวันเดียวกัน (ห้ามละเมิดเด็ดขาด)"""
        for u in self.users:
            for d in self.days:
                lit = self._assume(
                    "NO_DOUBLE_BOOKING",
                    f"{u} ต้องไม่ได้รับมอบหมายมากกว่า 1 เวรในวันที่ {d.isoformat()}",
                )
                self.model.Add(sum(self.x[(u, d, sc)] for sc in self.shift_codes) <= 1).OnlyEnforceIf(lit)

    def add_approved_leave_block(self) -> None:
        """Hard: วันลาที่อนุมัติแล้วห้ามมอบหมายเวรทับ (PRD หัวข้อ 4.3 ขั้นตอนที่ 3)"""
        for leave in self.request.approved_leaves:
            u = leave["user_id"]
            start = date.fromisoformat(leave["start_date"])
            end = date.fromisoformat(leave["end_date"])
            d = start
            while d <= end:
                if (u, d) in {(uu, dd) for uu in [u] for dd in self.days}:
                    lit = self._assume(
                        "APPROVED_LEAVE_BLOCK",
                        f"{u} อยู่ระหว่างลาที่อนุมัติแล้ว {start.isoformat()}–{end.isoformat()}",
                    )
                    for sc in self.shift_codes:
                        if (u, d, sc) in self.x:
                            self.model.Add(self.x[(u, d, sc)] == 0).OnlyEnforceIf(lit)
                d += timedelta(days=1)

    def add_min_staff_per_shift(self) -> None:
        """
        Hard: จำนวนบุคลากรขั้นต่ำต่อเวร (Nurse-to-Patient Ratio แปลงเป็น FTE แล้ว)
        อ่านจาก rule ruleKey = "MIN_STAFF_PER_SHIFT" parameters {"shiftCode":"NIGHT","min":3}
        หรือจาก required_fte ถ้า FR-AI02 ส่งมาให้ (ละเอียดกว่า เพราะแยกตามระดับ RN/PN/NA)
        """
        fte_by_day_shift: dict[tuple[date, str], dict[str, int]] = defaultdict(dict)
        for rfte in self.request.required_fte:
            fte_by_day_shift[(rfte.date, rfte.shift_type_code)] = {
                "RN": rfte.rn,
                "PN": rfte.pn,
                "NA": rfte.na,
            }

        for rule in self.request.rules:
            if rule.rule_type.value != "HARD" or rule.rule_key != "MIN_STAFF_PER_SHIFT":
                continue
            shift_code = rule.parameters.get("shiftCode")
            min_count = rule.parameters.get("min", 0)
            for d in self.days:
                users_on_shift = [self.x[(u, d, shift_code)] for u in self.users if (u, d, shift_code) in self.x]
                if not users_on_shift:
                    continue
                required = fte_by_day_shift.get((d, shift_code), {}).get("TOTAL", min_count)
                lit = self._assume(
                    "MIN_STAFF_PER_SHIFT",
                    f"เวร {shift_code} วันที่ {d.isoformat()} ต้องมีบุคลากรอย่างน้อย {required} คน",
                )
                self.model.Add(sum(users_on_shift) >= required).OnlyEnforceIf(lit)

    def add_max_consecutive_shift_type(self) -> None:
        """Hard: จำนวนเวรดึกติดต่อกันไม่เกินเกณฑ์ (ruleKey = MAX_CONSECUTIVE_NIGHT_SHIFTS)"""
        for rule in self.request.rules:
            if rule.rule_type.value != "HARD" or rule.rule_key != "MAX_CONSECUTIVE_NIGHT_SHIFTS":
                continue
            max_days = rule.parameters.get("maxConsecutiveDays", 3)
            shift_code = rule.parameters.get("shiftCode", "NIGHT")
            for u in self.users:
                for i in range(len(self.days) - max_days):
                    window = self.days[i : i + max_days + 1]
                    vars_in_window = [self.x[(u, d, shift_code)] for d in window if (u, d, shift_code) in self.x]
                    if len(vars_in_window) <= max_days:
                        continue
                    lit = self._assume(
                        "MAX_CONSECUTIVE_NIGHT_SHIFTS",
                        f"{u} ต้องไม่ขึ้นเวร {shift_code} ติดต่อกันเกิน {max_days} วัน "
                        f"(หน้าต่าง {window[0].isoformat()}–{window[-1].isoformat()})",
                    )
                    self.model.Add(sum(vars_in_window) <= max_days).OnlyEnforceIf(lit)

    def add_min_rest_between_shifts(self) -> None:
        """
        Hard: ห้าม Quick Return — เวรดึก (จบ 08:00) ต่อด้วยเวรเช้าวันถัดไป (เริ่ม 08:00) ถือว่า
        พักไม่ครบเกณฑ์ขั้นต่ำ (ruleKey = MIN_REST_HOURS)
        """
        night_codes = [sc for sc, meta in self.shift_by_code.items() if meta.get("crossesMidnight")]
        morning_codes = [sc for sc, meta in self.shift_by_code.items() if not meta.get("crossesMidnight")]
        has_rule = any(r.rule_key == "MIN_REST_HOURS" and r.rule_type.value == "HARD" for r in self.request.rules)
        if not has_rule or not night_codes:
            return

        for u in self.users:
            for i, d in enumerate(self.days[:-1]):
                next_day = self.days[i + 1]
                for nc in night_codes:
                    for mc in morning_codes:
                        if (u, d, nc) not in self.x or (u, next_day, mc) not in self.x:
                            continue
                        lit = self._assume(
                            "MIN_REST_HOURS",
                            f"{u} ขึ้นเวร {nc} วันที่ {d.isoformat()} แล้วต้องไม่ขึ้นเวร {mc} "
                            f"วันที่ {next_day.isoformat()} ทันที (พักไม่ครบเกณฑ์ขั้นต่ำ — Quick Return)",
                        )
                        self.model.Add(self.x[(u, d, nc)] + self.x[(u, next_day, mc)] <= 1).OnlyEnforceIf(lit)

    def build_all(self) -> None:
        self.add_no_double_booking()
        self.add_approved_leave_block()
        self.add_min_staff_per_shift()
        self.add_max_consecutive_shift_type()
        self.add_min_rest_between_shifts()
        self.add_fixed_assignment_pins()


def _night_shift_counts(builder: HardConstraintBuilder, solver: cp_model.CpSolver) -> dict[str, int]:
    night_codes = [sc for sc, meta in builder.shift_by_code.items() if meta.get("crossesMidnight")]
    counts: dict[str, int] = {u: 0 for u in builder.users}
    for u in builder.users:
        for d in builder.days:
            for nc in night_codes:
                if (u, d, nc) in builder.x and solver.Value(builder.x[(u, d, nc)]):
                    counts[u] += 1
    return counts


def _gini(values: list[int]) -> float:
    if not values or sum(values) == 0:
        return 0.0
    sorted_v = sorted(values)
    n = len(sorted_v)
    cum = sum((i + 1) * v for i, v in enumerate(sorted_v))
    return (2 * cum) / (n * sum(sorted_v)) - (n + 1) / n


def _add_spread_var(model: cp_model.CpModel, counts: list, upper_bound: int, name: str):
    """ตัวแปร max-min ของลิสต์ตัวแปรจำนวนเต็ม — ใช้เป็น Proxy ความเป็นธรรม (ยิ่งน้อยยิ่งเท่ากัน)"""
    mx = model.NewIntVar(0, upper_bound, f"max_{name}")
    mn = model.NewIntVar(0, upper_bound, f"min_{name}")
    model.AddMaxEquality(mx, counts)
    model.AddMinEquality(mn, counts)
    return mx - mn


def _build_pattern_transitions(model: cp_model.CpModel, builder: HardConstraintBuilder) -> list:
    """MVP 2 Sprint 6 (SHIFT_PATTERN_CONTINUITY): นับจำนวนครั้งที่บุคคลเปลี่ยนประเภทเวรระหว่าง
    วันทำงานที่ติดกัน (ทั้งคู่มีเวร แต่คนละประเภท) เป็น Proxy ของ "ความต่อเนื่องของรูปแบบเวร" —
    PRD ไม่ได้กำหนดสูตรไว้ชัดเจน จึงเลือกตีความแบบนี้: การสลับ เช้า/บ่าย/ดึก ไปมาวันเว้นวันถือว่า
    ต่อเนื่องน้อยกว่าการขึ้นเวรประเภทเดียวกันติดกันหลายวัน (ไม่นับวันหยุดเป็นการเปลี่ยนรูปแบบ)"""
    transitions = []
    for u in builder.users:
        for i in range(len(builder.days) - 1):
            d_prev, d_cur = builder.days[i], builder.days[i + 1]
            codes_prev = [sc for sc in builder.shift_codes if (u, d_prev, sc) in builder.x]
            codes_cur = [sc for sc in builder.shift_codes if (u, d_cur, sc) in builder.x]
            if not codes_prev or not codes_cur:
                continue

            works_prev = model.NewBoolVar(f"works_{u}_{d_prev}")
            works_cur = model.NewBoolVar(f"works_{u}_{d_cur}")
            model.Add(sum(builder.x[(u, d_prev, sc)] for sc in codes_prev) == works_prev)
            model.Add(sum(builder.x[(u, d_cur, sc)] for sc in codes_cur) == works_cur)

            same_code_terms = []
            for sc in set(codes_prev) & set(codes_cur):
                b = model.NewBoolVar(f"same_{u}_{d_cur}_{sc}")
                model.AddMultiplicationEquality(b, [builder.x[(u, d_prev, sc)], builder.x[(u, d_cur, sc)]])
                same_code_terms.append(b)
            same_code = model.NewBoolVar(f"samecode_{u}_{d_cur}")
            if same_code_terms:
                model.AddMaxEquality(same_code, same_code_terms)
            else:
                model.Add(same_code == 0)

            transition = model.NewBoolVar(f"transition_{u}_{d_cur}")
            model.AddBoolAnd([works_prev, works_cur, same_code.Not()]).OnlyEnforceIf(transition)
            model.AddBoolOr([works_prev.Not(), works_cur.Not(), same_code]).OnlyEnforceIf(transition.Not())
            transitions.append(transition)
    return transitions


def _build_soft_objective(model: cp_model.CpModel, builder: HardConstraintBuilder, request: ScheduleSuggestRequest) -> None:
    """MVP 2 Sprint 6: Objective Function แบบถ่วงน้ำหนักจาก Soft SchedulingRule จริงที่ส่งมา
    (ก่อนหน้านี้ scaffold เดิมมีแค่ fairness เวรดึกแบบ hardcode ไม่ผ่านน้ำหนักจาก rule.weight เลย)
    รองรับ ruleKey ใน MODELED_SOFT_RULE_KEYS — PERSONAL_PREFERENCE รับไว้แต่ยังไม่มีผลเพราะยังไม่มี
    Input ความต้องการส่วนบุคคลจริงจนกว่าจะถึง Sprint 21 (ส่วนขยาย)"""
    terms = []  # list[(LinearExpr, int weight)]
    night_codes = [sc for sc, meta in builder.shift_by_code.items() if meta.get("crossesMidnight")]
    # ยังไม่มี Public Holiday Calendar ในระบบ (ไม่มี Model นี้ใน schema.prisma) — ตีความ
    # "เวรวันหยุด" เป็นเสาร์-อาทิตย์ไปก่อน ต้องปรับเมื่อมีปฏิทินวันหยุดนักขัตฤกษ์จริง
    holiday_days = [d for d in builder.days if d.weekday() >= 5]

    for rule in request.rules:
        if rule.rule_type.value != "SOFT" or rule.rule_key not in MODELED_SOFT_RULE_KEYS:
            continue
        weight = max(1, round(rule.weight or 1))

        if rule.rule_key == "NIGHT_SHIFT_FAIRNESS" and night_codes:
            counts = [
                sum(builder.x[(u, d, nc)] for d in builder.days for nc in night_codes if (u, d, nc) in builder.x)
                for u in builder.users
            ]
            if counts:
                terms.append((_add_spread_var(model, counts, len(builder.days), "night_fair"), weight))

        elif rule.rule_key == "HOLIDAY_SHIFT_FAIRNESS" and holiday_days:
            counts = [
                sum(
                    builder.x[(u, d, sc)]
                    for d in holiday_days
                    for sc in builder.shift_codes
                    if (u, d, sc) in builder.x
                )
                for u in builder.users
            ]
            if counts:
                terms.append((_add_spread_var(model, counts, len(holiday_days), "holiday_fair"), weight))

        elif rule.rule_key == "SHIFT_PATTERN_CONTINUITY":
            transitions = _build_pattern_transitions(model, builder)
            if transitions:
                terms.append((sum(transitions), weight))

    if terms:
        model.Minimize(sum(expr * w for expr, w in terms))


def _predicted_ot_hours(builder: HardConstraintBuilder, solver: cp_model.CpSolver) -> float:
    """เชื่อม ShiftType.compensationRate จริง: นับชั่วโมงของเวรที่มีอัตราค่าตอบแทน > 1.0
    (เวร Premium เช่นเวรดึก/เวรพิเศษ) เป็นชั่วโมง OT ที่คาดการณ์ — ค่าที่ 1.0 คือฐานปกติ"""
    total = 0.0
    for sc, meta in builder.shift_by_code.items():
        rate = meta.get("compensationRate", 1.0) or 1.0
        if rate <= 1.0:
            continue
        hours = shift_hours(meta)
        count = sum(
            1
            for u in builder.users
            for d in builder.days
            if (u, d, sc) in builder.x and solver.Value(builder.x[(u, d, sc)])
        )
        total += hours * count
    return round(total, 2)


def _swap_candidate(
    builder: HardConstraintBuilder,
    assigned: dict[tuple[str, date], str],
    u: str,
    d: date,
    sc: str,
) -> str | None:
    """MVP 2 Sprint 7 (Explainability): หาอีก 1 คนที่ "น่าจะ" สลับมาขึ้นเวรนี้แทนได้โดยไม่ละเมิด
    Hard Constraint หลัก (จองซ้อน, Quick Return, เวรดึกติดต่อกันเกินเกณฑ์) — เป็น Heuristic
    อย่างง่ายสำหรับ change_impact_if_swapped ไม่ใช่การค้นหาคำตอบใหม่แบบ CP-SAT"""
    night_codes = {c for c, meta in builder.shift_by_code.items() if meta.get("crossesMidnight")}
    morning_codes = {c for c in builder.shift_codes if c not in night_codes}
    max_consecutive = next(
        (
            r.parameters.get("maxConsecutiveDays", 3)
            for r in builder.request.rules
            if r.rule_type.value == "HARD" and r.rule_key == "MAX_CONSECUTIVE_NIGHT_SHIFTS"
        ),
        None,
    )
    day_index = {day: i for i, day in enumerate(builder.days)}
    i = day_index[d]

    for c in builder.users:
        if c == u or (c, d) in assigned:
            continue
        prev_day = builder.days[i - 1] if i > 0 else None
        next_day = builder.days[i + 1] if i + 1 < len(builder.days) else None
        if sc in night_codes and next_day and assigned.get((c, next_day)) in morning_codes:
            continue  # จะเกิด Quick Return
        if sc in morning_codes and prev_day and assigned.get((c, prev_day)) in night_codes:
            continue  # จะเกิด Quick Return
        if sc in night_codes and max_consecutive is not None:
            run = 1
            j = i - 1
            while j >= 0 and assigned.get((c, builder.days[j])) == sc:
                run += 1
                j -= 1
            if run > max_consecutive:
                continue  # จะเกิดเวรดึกติดต่อกันเกินเกณฑ์
        return c
    return None


def solve_schedule(request: ScheduleSuggestRequest) -> ScheduleSuggestResult:
    """
    เกณฑ์ยอมรับตาม PRD หัวข้อ 5.4.3:
      - การละเมิด Hard Constraint = 0 รายการ
      - เวลาประมวลผล ≤ 60 วินาที สำหรับ 80 คน x 31 วัน
      - ทุกช่องต้องแสดงคำอธิบายเหตุผลได้ 100%
      - กรณี Infeasible ต้องระบุเงื่อนไขที่ขัดแย้งได้ 100%
    """
    start_time = time.monotonic()
    model = cp_model.CpModel()
    builder = HardConstraintBuilder(model, request)
    builder.build_all()

    # MVP 2 Sprint 6: Objective Function แบบถ่วงน้ำหนักจาก Soft SchedulingRule จริงที่ส่งมา
    # (ดูรายละเอียดการตีความ NIGHT_SHIFT_FAIRNESS / HOLIDAY_SHIFT_FAIRNESS /
    # SHIFT_PATTERN_CONTINUITY ที่ฟังก์ชัน _build_soft_objective ด้านบน)
    _build_soft_objective(model, builder, request)

    assumption_lits = list(builder.assumptions.keys())
    model.AddAssumptions(assumption_lits)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = request.time_limit_seconds
    solver.parameters.num_search_workers = 8

    status = solver.Solve(model)

    # หมายเหตุสำคัญ: SufficientAssumptionsForInfeasibility() ไม่น่าเชื่อถือเมื่อใช้
    # num_search_workers > 1 (พิสูจน์ด้วย Unit Test — ดู tests/test_solver.py) จึง
    # สั่ง Solve ซ้ำแบบ Single-thread เฉพาะกรณี Infeasible เพื่อวินิจฉัยที่ถูกต้อง
    # ตาม AIP-01 ("กรณีจัดไม่สำเร็จต้องระบุเงื่อนไขที่ขัดแย้งกัน ไม่ใช่กล่องดำ")
    # ซึ่งยอมรับได้เพราะไม่กระทบเวลาของกรณี Feasible (เกณฑ์ ≤60s ใช้กับกรณีหาคำตอบได้)
    if status == cp_model.INFEASIBLE:
        diagnostic_solver = cp_model.CpSolver()
        diagnostic_solver.parameters.max_time_in_seconds = request.time_limit_seconds
        diagnostic_solver.parameters.num_search_workers = 1
        status = diagnostic_solver.Solve(model)
        solver = diagnostic_solver

    elapsed = time.monotonic() - start_time

    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        night_codes = {sc for sc, meta in builder.shift_by_code.items() if meta.get("crossesMidnight")}
        soft_rule_keys = {
            r.rule_key for r in request.rules if r.rule_type.value == "SOFT" and r.rule_key in MODELED_SOFT_RULE_KEYS
        }
        max_consecutive_night = next(
            (
                r.parameters.get("maxConsecutiveDays", 3)
                for r in request.rules
                if r.rule_type.value == "HARD" and r.rule_key == "MAX_CONSECUTIVE_NIGHT_SHIFTS"
            ),
            None,
        )
        min_staff_rules = {
            r.parameters.get("shiftCode"): r.parameters.get("min")
            for r in request.rules
            if r.rule_type.value == "HARD" and r.rule_key == "MIN_STAFF_PER_SHIFT" and r.parameters
        }

        # ลำดับเดียวที่แน่ชัดในการอ่านค่า solver.Value() ก่อน — ใช้สร้างทั้ง assignments และ
        # เป็นตารางอ้างอิงสำหรับ _swap_candidate (คำนวณครั้งเดียว ไม่ query solver ซ้ำ)
        assigned_lookup: dict[tuple[str, date], str] = {}
        for u in builder.users:
            for d in builder.days:
                for sc in builder.shift_codes:
                    if (u, d, sc) in builder.x and solver.Value(builder.x[(u, d, sc)]):
                        assigned_lookup[(u, d)] = sc

        day_index = {d: i for i, d in enumerate(builder.days)}
        assignments = []
        for (u, d), sc in assigned_lookup.items():
            reasons = [f"ผ่านเงื่อนไขบังคับทั้งหมดที่เกี่ยวข้องกับ {u} ในวันที่ {d.isoformat()}"]

            if sc in night_codes and max_consecutive_night is not None:
                run = 1
                j = day_index[d] - 1
                while j >= 0 and assigned_lookup.get((u, builder.days[j])) == sc:
                    run += 1
                    j -= 1
                reasons.append(f"เป็นวันที่ {run} ของเวรดึกติดต่อกัน (ไม่เกินเกณฑ์ {max_consecutive_night} วัน)")

            if sc in min_staff_rules:
                reasons.append(f"จำนวนคนขึ้นเวร {sc} วันนี้ตรงตามขั้นต่ำที่กำหนด ({min_staff_rules[sc]} คน)")

            if "NIGHT_SHIFT_FAIRNESS" in soft_rule_keys and sc in night_codes:
                reasons.append("นับรวมในดัชนีความเป็นธรรมของเวรดึก (NIGHT_SHIFT_FAIRNESS)")

            reasons.append("ไม่มีวันลาที่อนุมัติทับช่วงนี้")

            swap = _swap_candidate(builder, assigned_lookup, u, d, sc)
            change_impact = (
                f"หากต้องการสลับเวรนี้ แนะนำให้สลับกับ {swap} (ไม่ละเมิดเงื่อนไขบังคับหลัก)"
                if swap
                else "ไม่พบผู้ที่สามารถสลับเวรนี้ได้โดยไม่ละเมิดเงื่อนไขบังคับในขณะนี้"
            )

            assignments.append(
                AssignmentExplanation(
                    user_id=u,
                    date=d,
                    shift_type_code=sc,
                    reasons=reasons,
                    change_impact_if_swapped=change_impact,
                )
            )

        night_counts_val = _night_shift_counts(builder, solver)
        gini = _gini(list(night_counts_val.values()))

        return ScheduleSuggestResult(
            status="OPTIMAL" if status == cp_model.OPTIMAL else "TIMEOUT_BEST_EFFORT",
            assignments=assignments,
            quality_score=QualityScore(
                fairness_index=1 - gini,
                gini_coefficient=gini,
                predicted_total_ot_hours=_predicted_ot_hours(builder, solver),
            ),
            solve_time_seconds=elapsed,
        )

    # Infeasible: วินิจฉัยด้วย Assumption — หา Sufficient Assumptions ที่ทำให้ Infeasible
    #
    # หมายเหตุสำคัญ (พบจาก Unit Test): SufficientAssumptionsForInfeasibility() คืนค่าเป็น
    # "ดัชนีตัวแปร" (int, ตรงกับ IntVar.Index()) ไม่ใช่ตัว IntVar object เอง — ต้องสร้าง
    # ตาราง index -> lit ก่อน ไม่เช่นนั้น `lit in builder.assumptions` จะไม่ match และคืน
    # ลิสต์ว่างเงียบๆ (silent failure) ซึ่งขัดกับ AIP-01 ที่บังคับว่าต้องระบุเหตุผลได้ 100%
    index_to_lit = {lit.Index(): lit for lit in builder.assumptions}
    conflicting_indices = solver.SufficientAssumptionsForInfeasibility()
    conflicting_lits = [index_to_lit[i] for i in conflicting_indices if i in index_to_lit]
    conflicting_rule_keys = sorted({builder.assumptions[lit][0] for lit in conflicting_lits})
    explanations = [builder.assumptions[lit][1] for lit in conflicting_lits]

    return ScheduleSuggestResult(
        status="INFEASIBLE",
        infeasible_reason=InfeasibleReason(
            conflicting_rule_keys=conflicting_rule_keys,
            explanation=(
                "หาคำตอบที่ผ่านเงื่อนไขบังคับทั้งหมดไม่ได้ เงื่อนไขที่ขัดแย้งกันคือ: "
                + "; ".join(explanations[:10])
            ),
            suggested_relaxations=[
                "ยืมกำลังคนจาก Ward อื่นมาเสริมในช่วงที่ขาด",
                "ขออนุมัติผ่อนผันเกณฑ์เฉพาะกรณีจากผู้บริหาร",
                "พิจารณาเปิดเวรพิเศษ (Overtime) เพิ่มเติม",
            ],
        ),
        solve_time_seconds=elapsed,
    )


def check_conflicts(request: ConflictCheckRequest) -> ConflictCheckResult:
    """
    FR-A10 — ตรวจความขัดแย้งของตารางเวรที่มนุษย์แก้มือกับกฎระเบียบทุกข้อ "ในโหมดตรวจสอบ"
    (ไม่ค้นหาคำตอบใหม่เหมือน solve_schedule — ประเมินตรงจากข้อมูลที่ fix ไว้แล้ว)

    ตาม ADR-0002 docstring ของไฟล์นี้: ต้องใช้ความหมายของ ruleKey/parameters ชุดเดียวกับ
    HardConstraintBuilder เป๊ะ ๆ เพื่อไม่ให้ตารางที่ Conflict Check บอกว่า "ผ่าน" กลับกลายเป็น
    ตารางที่ AI Solver (MVP 2) มองว่าละเมิด Hard Constraint — ด้านล่างนี้คือการ Mirror
    ตรรกะของแต่ละ add_*() method แต่ทำงานแบบประเมินตรง (ไม่ผ่าน CP-SAT) เพราะ Input
    เป็นตารางที่ถูกกำหนดครบแล้ว ไม่ใช่ตัวแปรที่ต้องค้นหา
    """
    shift_by_code = {s["code"]: s for s in request.shift_types}
    night_codes = {sc for sc, meta in shift_by_code.items() if meta.get("crossesMidnight")}
    morning_codes = {sc for sc in shift_by_code if sc not in night_codes}

    by_user: dict[str, list[ConflictCheckAssignment]] = defaultdict(list)
    by_user_date: dict[tuple[str, date], list[ConflictCheckAssignment]] = defaultdict(list)
    by_date_shift: dict[tuple[date, str], list[ConflictCheckAssignment]] = defaultdict(list)
    for a in request.assignments:
        by_user[a.user_id].append(a)
        by_user_date[(a.user_id, a.date)].append(a)
        by_date_shift[(a.date, a.shift_type_code)].append(a)
    for items in by_user.values():
        items.sort(key=lambda a: a.date)

    violations: list[ConflictViolation] = []

    # NO_DOUBLE_BOOKING — บังคับที่ชั้น DB (unique [userId,date]) อยู่แล้วสำหรับ Schedule
    # เดียว แต่ตรวจซ้ำที่นี่เผื่อกรณีอนาคตที่ส่งข้อมูลข้าม Schedule มาตรวจพร้อมกัน
    for (uid, d), items in by_user_date.items():
        if len(items) > 1:
            violations.append(
                ConflictViolation(
                    rule_key="NO_DOUBLE_BOOKING",
                    message=f"{uid} มีเวรมอบหมายมากกว่า 1 เวรในวันที่ {d.isoformat()}",
                    locations=[
                        ConflictLocation(
                            assignment_id=i.assignment_id, user_id=uid, date=d, shift_type_code=i.shift_type_code
                        )
                        for i in items
                    ],
                )
            )

    for rule in request.rules:
        if rule.rule_type.value != "HARD":
            continue

        if rule.rule_key == "MIN_STAFF_PER_SHIFT":
            shift_code = rule.parameters.get("shiftCode")
            min_count = rule.parameters.get("min", 0)
            d = date(request.year, request.month, 1)
            while d.month == request.month:
                items = by_date_shift.get((d, shift_code), [])
                if len(items) < min_count:
                    locations = [
                        ConflictLocation(
                            assignment_id=i.assignment_id, user_id=i.user_id, date=d, shift_type_code=shift_code
                        )
                        for i in items
                    ] or [ConflictLocation(user_id="-", date=d, shift_type_code=shift_code)]
                    violations.append(
                        ConflictViolation(
                            rule_key="MIN_STAFF_PER_SHIFT",
                            message=(
                                f"เวร {shift_code} วันที่ {d.isoformat()} มีบุคลากร {len(items)} คน "
                                f"ต่ำกว่าเกณฑ์ขั้นต่ำ {min_count} คน"
                            ),
                            locations=locations,
                        )
                    )
                d += timedelta(days=1)

        elif rule.rule_key == "MAX_CONSECUTIVE_NIGHT_SHIFTS":
            max_days = rule.parameters.get("maxConsecutiveDays", 3)
            shift_code = rule.parameters.get("shiftCode", "NIGHT")
            for uid, items in by_user.items():
                run: list[ConflictCheckAssignment] = []
                for a in items:
                    if a.shift_type_code != shift_code:
                        continue
                    if run and (a.date - run[-1].date).days == 1:
                        run.append(a)
                    else:
                        run = [a]
                    if len(run) > max_days:
                        violations.append(
                            ConflictViolation(
                                rule_key="MAX_CONSECUTIVE_NIGHT_SHIFTS",
                                message=(
                                    f"{uid} ขึ้นเวร {shift_code} ติดต่อกัน {len(run)} วัน เกินเกณฑ์ {max_days} วัน "
                                    f"(ช่วง {run[0].date.isoformat()}–{run[-1].date.isoformat()})"
                                ),
                                locations=[
                                    ConflictLocation(
                                        assignment_id=x.assignment_id,
                                        user_id=uid,
                                        date=x.date,
                                        shift_type_code=x.shift_type_code,
                                    )
                                    for x in run
                                ],
                            )
                        )

        elif rule.rule_key == "MIN_REST_HOURS":
            for uid, items in by_user.items():
                for i in range(len(items) - 1):
                    cur, nxt = items[i], items[i + 1]
                    if (nxt.date - cur.date).days != 1:
                        continue
                    if cur.shift_type_code in night_codes and nxt.shift_type_code in morning_codes:
                        violations.append(
                            ConflictViolation(
                                rule_key="MIN_REST_HOURS",
                                message=(
                                    f"{uid} ขึ้นเวร {cur.shift_type_code} วันที่ {cur.date.isoformat()} แล้วขึ้นเวร "
                                    f"{nxt.shift_type_code} วันที่ {nxt.date.isoformat()} ทันที "
                                    "(พักไม่ครบเกณฑ์ขั้นต่ำ — Quick Return)"
                                ),
                                locations=[
                                    ConflictLocation(
                                        assignment_id=cur.assignment_id,
                                        user_id=uid,
                                        date=cur.date,
                                        shift_type_code=cur.shift_type_code,
                                    ),
                                    ConflictLocation(
                                        assignment_id=nxt.assignment_id,
                                        user_id=uid,
                                        date=nxt.date,
                                        shift_type_code=nxt.shift_type_code,
                                    ),
                                ],
                            )
                        )

        elif rule.rule_key == "APPROVED_LEAVE_BLOCK":
            # MVP 3 Sprint 9 เป็นผู้ส่ง approved_leaves จริง — MVP 1 ยังไม่มีข้อมูลนี้
            for leave in request.approved_leaves:
                uid = leave["user_id"]
                start = date.fromisoformat(leave["start_date"])
                end = date.fromisoformat(leave["end_date"])
                for a in by_user.get(uid, []):
                    if start <= a.date <= end:
                        violations.append(
                            ConflictViolation(
                                rule_key="APPROVED_LEAVE_BLOCK",
                                message=(
                                    f"{uid} ถูกมอบหมายเวร {a.shift_type_code} วันที่ {a.date.isoformat()} "
                                    f"ซึ่งอยู่ระหว่างวันลาที่อนุมัติแล้ว ({start.isoformat()}–{end.isoformat()})"
                                ),
                                locations=[
                                    ConflictLocation(
                                        assignment_id=a.assignment_id,
                                        user_id=uid,
                                        date=a.date,
                                        shift_type_code=a.shift_type_code,
                                    )
                                ],
                            )
                        )

    return ConflictCheckResult(is_valid=len(violations) == 0, violations=violations)
