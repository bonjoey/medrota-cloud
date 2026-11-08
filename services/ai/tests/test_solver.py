"""
ทดสอบ FR-AI01 CP-SAT Solver — เกณฑ์ยอมรับตาม PRD หัวข้อ 5.4.3:
  - การละเมิด Hard Constraint = 0 รายการ
  - กรณี Infeasible ต้องระบุเงื่อนไขที่ขัดแย้งได้ 100%
"""
from datetime import date

from app.schemas import (
    ConflictCheckAssignment,
    ResolveWindow,
    ScheduleSuggestRequest,
    SchedulingRule,
    StaffMember,
)
from app.solver.constraint_model import solve_schedule

SHIFT_TYPES = [
    {"code": "MORNING", "crossesMidnight": False},
    {"code": "NIGHT", "crossesMidnight": True},
]


def _base_request(**overrides) -> ScheduleSuggestRequest:
    defaults = dict(
        hospital_id="h1",
        ward_id="w1",
        month=1,
        year=2026,
        staff=[
            StaffMember(user_id="u1", position_level="RN", ward_id="w1"),
            StaffMember(user_id="u2", position_level="RN", ward_id="w1"),
            StaffMember(user_id="u3", position_level="PN", ward_id="w1"),
        ],
        shift_types=SHIFT_TYPES,
        rules=[
            SchedulingRule(
                rule_key="MIN_STAFF_PER_SHIFT",
                rule_type="HARD",
                parameters={"shiftCode": "MORNING", "min": 1},
            ),
            SchedulingRule(
                rule_key="MAX_CONSECUTIVE_NIGHT_SHIFTS",
                rule_type="HARD",
                parameters={"shiftCode": "NIGHT", "maxConsecutiveDays": 2},
            ),
        ],
        time_limit_seconds=10,
    )
    defaults.update(overrides)
    return ScheduleSuggestRequest(**defaults)


def test_feasible_schedule_has_no_double_booking():
    request = _base_request()
    result = solve_schedule(request)

    assert result.status in ("OPTIMAL", "TIMEOUT_BEST_EFFORT")

    seen = set()
    for a in result.assignments:
        key = (a.user_id, a.date)
        assert key not in seen, "พบการมอบหมายเวรซ้อนทับ — ละเมิด Hard Constraint NO_DOUBLE_BOOKING"
        seen.add(key)


def test_min_staff_per_shift_is_respected():
    request = _base_request()
    result = solve_schedule(request)

    by_day_shift: dict[tuple[date, str], int] = {}
    for a in result.assignments:
        key = (a.date, a.shift_type_code)
        by_day_shift[key] = by_day_shift.get(key, 0) + 1

    for d in _month_days_for(request):
        count = by_day_shift.get((d, "MORNING"), 0)
        assert count >= 1, f"วันที่ {d} ขาดบุคลากรเวรเช้าต่ำกว่าเกณฑ์ขั้นต่ำ"


def _month_days_for(request: ScheduleSuggestRequest):
    """helper เพื่อ enumerate วันในเดือนเดียวกับที่ solver ใช้ (ไม่ import private เพื่อแยก concern)"""
    from app.solver.constraint_model import HardConstraintBuilder
    from ortools.sat.python import cp_model

    builder = HardConstraintBuilder(cp_model.CpModel(), request)
    return builder.days


def test_infeasible_reports_conflicting_rules():
    # บังคับให้ Infeasible: ต้องการเวรเช้าอย่างน้อย 10 คนต่อวัน แต่มีพนักงานแค่ 3 คน
    request = _base_request(
        rules=[
            SchedulingRule(
                rule_key="MIN_STAFF_PER_SHIFT",
                rule_type="HARD",
                parameters={"shiftCode": "MORNING", "min": 10},
            ),
        ],
    )
    result = solve_schedule(request)

    assert result.status == "INFEASIBLE"
    assert result.infeasible_reason is not None
    assert "MIN_STAFF_PER_SHIFT" in result.infeasible_reason.conflicting_rule_keys
    assert len(result.infeasible_reason.suggested_relaxations) > 0


def test_incremental_resolve_pins_cells_outside_window_exactly():
    """MVP 2 Sprint 8: นอก resolve_window ทุกช่องต้องตรงกับตารางเดิม (fixed_assignments) เป๊ะ ๆ
    รวมถึงวันที่ไม่มีเวรเดิมเลย (ต้องว่างต่อไป) — Solver ค้นหาใหม่ได้เฉพาะในหน้าต่างเท่านั้น"""
    full_request = _base_request()
    full_result = solve_schedule(full_request)
    assert full_result.status in ("OPTIMAL", "TIMEOUT_BEST_EFFORT")

    fixed = [
        ConflictCheckAssignment(
            assignment_id=f"{a.user_id}-{a.date.isoformat()}",
            user_id=a.user_id,
            date=a.date,
            shift_type_code=a.shift_type_code,
        )
        for a in full_result.assignments
    ]
    window = ResolveWindow(start_date=date(2026, 1, 9), end_date=date(2026, 1, 13))
    incremental_request = _base_request(
        fixed_assignments=[fa for fa in fixed if not (window.start_date <= fa.date <= window.end_date)],
        resolve_window=window,
    )
    incremental_result = solve_schedule(incremental_request)
    assert incremental_result.status in ("OPTIMAL", "TIMEOUT_BEST_EFFORT")

    by_key_full = {(a.user_id, a.date): a.shift_type_code for a in full_result.assignments}
    by_key_incr = {(a.user_id, a.date): a.shift_type_code for a in incremental_result.assignments}

    for u in [s.user_id for s in incremental_request.staff]:
        for d in _month_days_for(incremental_request):
            if window.start_date <= d <= window.end_date:
                continue
            assert by_key_full.get((u, d)) == by_key_incr.get((u, d)), (
                f"Incremental re-solve เปลี่ยนช่องนอก resolve_window ที่ {u}/{d} ซึ่งต้องถูกตรึงไว้"
            )


def test_incremental_resolve_reports_fixed_assignment_pin_conflict():
    """ถ้าการตรึงตารางเดิมนอกหน้าต่างเป็นสาเหตุให้ Infeasible ต้องระบุ FIXED_ASSIGNMENT_PIN
    เป็นหนึ่งใน conflicting_rule_keys ด้วย (ไม่ใช่แค่กฎ Hard Constraint อื่น) ตาม AIP-01"""
    shift_types = [{"code": "NIGHT", "startTime": "20:00", "endTime": "08:00", "crossesMidnight": True}]
    staff = [StaffMember(user_id="u1", position_level="RN", ward_id="w1")]
    rules = [
        SchedulingRule(rule_key="MIN_STAFF_PER_SHIFT", rule_type="HARD", parameters={"shiftCode": "NIGHT", "min": 1}),
    ]
    window = ResolveWindow(start_date=date(2026, 1, 5), end_date=date(2026, 1, 31))
    request = ScheduleSuggestRequest(
        hospital_id="h1",
        ward_id="w1",
        month=1,
        year=2026,
        staff=staff,
        shift_types=shift_types,
        rules=rules,
        fixed_assignments=[],  # u1 ว่างทุกวันนอกหน้าต่าง แต่ MIN_STAFF_PER_SHIFT บังคับว่าต้องมีคนขึ้นเวรทุกวัน
        resolve_window=window,
        time_limit_seconds=10,
    )
    result = solve_schedule(request)

    assert result.status == "INFEASIBLE"
    assert "FIXED_ASSIGNMENT_PIN" in result.infeasible_reason.conflicting_rule_keys
