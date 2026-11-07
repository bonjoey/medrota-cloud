"""
ทดสอบ FR-AI01 CP-SAT Solver — เกณฑ์ยอมรับตาม PRD หัวข้อ 5.4.3:
  - การละเมิด Hard Constraint = 0 รายการ
  - กรณี Infeasible ต้องระบุเงื่อนไขที่ขัดแย้งได้ 100%
"""
from datetime import date

from app.schemas import ScheduleSuggestRequest, SchedulingRule, StaffMember
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
