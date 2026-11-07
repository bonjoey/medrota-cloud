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
    InfeasibleReason,
    QualityScore,
    ScheduleSuggestRequest,
    ScheduleSuggestResult,
)


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

    # Soft objective: ขั้นต่ำสุดในชั้นนี้ของ scaffold คือ fairness ของเวรดึก (ค่าเต็มตาม
    # Objective Function แบบถ่วงน้ำหนักทั้งหมดดูใน MVP 2 Sprint 6 ของ MVP_ExecutionPlan)
    night_codes = [sc for sc, meta in builder.shift_by_code.items() if meta.get("crossesMidnight")]
    if night_codes:
        night_counts = [
            sum(builder.x[(u, d, nc)] for d in builder.days for nc in night_codes if (u, d, nc) in builder.x)
            for u in builder.users
        ]
        if night_counts:
            max_night = model.NewIntVar(0, len(builder.days), "max_night")
            min_night = model.NewIntVar(0, len(builder.days), "min_night")
            model.AddMaxEquality(max_night, night_counts)
            model.AddMinEquality(min_night, night_counts)
            model.Minimize(max_night - min_night)

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
        assignments = []
        for u in builder.users:
            for d in builder.days:
                for sc in builder.shift_codes:
                    if (u, d, sc) in builder.x and solver.Value(builder.x[(u, d, sc)]):
                        assignments.append(
                            AssignmentExplanation(
                                user_id=u,
                                date=d,
                                shift_type_code=sc,
                                reasons=[
                                    f"ผ่านเงื่อนไขบังคับทั้งหมดที่เกี่ยวข้องกับ {u} ในวันที่ {d.isoformat()}",
                                    "ไม่มีวันลาที่อนุมัติทับช่วงนี้" ,
                                ],
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
                predicted_total_ot_hours=0.0,  # TODO: คำนวณจริงเมื่อเชื่อม ShiftType.compensationRate
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
