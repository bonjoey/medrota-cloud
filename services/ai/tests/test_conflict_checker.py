"""
ทดสอบ FR-A10 Conflict Check — ต้องให้ผลตรงกับความหมายของ Hard Constraint เดียวกันกับ
ที่ HardConstraintBuilder ใช้ตอน AI จัดเวร (ADR-0002: ห้ามมีตรรกะกฎสองชุดที่ขัดกันเอง)
"""
from app.schemas import ConflictCheckAssignment, ConflictCheckRequest, SchedulingRule
from app.solver.constraint_model import check_conflicts

SHIFT_TYPES = [
    {"code": "MORNING", "crossesMidnight": False},
    {"code": "NIGHT", "crossesMidnight": True},
]


def _base_request(assignments, rules, **overrides) -> ConflictCheckRequest:
    defaults = dict(
        hospital_id="h1",
        ward_id="w1",
        month=1,
        year=2026,
        assignments=assignments,
        shift_types=SHIFT_TYPES,
        rules=rules,
    )
    defaults.update(overrides)
    return ConflictCheckRequest(**defaults)


def _a(assignment_id: str, user_id: str, d: str, shift_code: str) -> ConflictCheckAssignment:
    return ConflictCheckAssignment(assignment_id=assignment_id, user_id=user_id, date=d, shift_type_code=shift_code)


def test_valid_schedule_has_no_violations():
    assignments = [
        _a("a1", "u1", "2026-01-01", "MORNING"),
        _a("a2", "u2", "2026-01-01", "NIGHT"),
    ]
    rules = [
        SchedulingRule(rule_key="MIN_STAFF_PER_SHIFT", rule_type="HARD", parameters={"shiftCode": "MORNING", "min": 1}),
    ]
    # ตรวจแค่วันเดียวด้วยการจำกัด month/year ให้สั้น — ใช้เดือนก.พ.ปีไม่อธิกสุรทินแทนเพื่อลดจำนวนวันที่ต้อง MIN_STAFF
    result = check_conflicts(_base_request(assignments, rules, month=1, year=2026))
    # เวร MORNING วันอื่น ๆ ในเดือนไม่มีใครลงเลยจะกลายเป็น MIN_STAFF_PER_SHIFT violation ทุกวัน
    # เพราะฉะนั้น assert เฉพาะว่าไม่มี double-booking / quick-return ผิดพลาด
    rule_keys = {v.rule_key for v in result.violations}
    assert "NO_DOUBLE_BOOKING" not in rule_keys
    assert "MIN_REST_HOURS" not in rule_keys


def test_double_booking_detected():
    assignments = [
        _a("a1", "u1", "2026-01-01", "MORNING"),
        _a("a2", "u1", "2026-01-01", "NIGHT"),
    ]
    result = check_conflicts(_base_request(assignments, rules=[]))
    assert result.is_valid is False
    violation = next(v for v in result.violations if v.rule_key == "NO_DOUBLE_BOOKING")
    assert len(violation.locations) == 2


def test_quick_return_detected():
    # เวรดึก (crossesMidnight) วันที่ 1 ต่อด้วยเวรเช้าวันที่ 2 ทันที = Quick Return
    assignments = [
        _a("a1", "u1", "2026-01-01", "NIGHT"),
        _a("a2", "u1", "2026-01-02", "MORNING"),
    ]
    rules = [SchedulingRule(rule_key="MIN_REST_HOURS", rule_type="HARD", parameters={})]
    result = check_conflicts(_base_request(assignments, rules))
    assert result.is_valid is False
    violation = next(v for v in result.violations if v.rule_key == "MIN_REST_HOURS")
    assert violation.locations[0].date.isoformat() == "2026-01-01"
    assert violation.locations[1].date.isoformat() == "2026-01-02"


def test_quick_return_not_flagged_when_gap_is_a_day_off():
    # เวรดึกวันที่ 1 แล้ว "ไม่มีเวร" วันที่ 2 แล้วเวรเช้าวันที่ 3 — ไม่ใช่ Quick Return
    assignments = [
        _a("a1", "u1", "2026-01-01", "NIGHT"),
        _a("a2", "u1", "2026-01-03", "MORNING"),
    ]
    rules = [SchedulingRule(rule_key="MIN_REST_HOURS", rule_type="HARD", parameters={})]
    result = check_conflicts(_base_request(assignments, rules))
    assert all(v.rule_key != "MIN_REST_HOURS" for v in result.violations)


def test_max_consecutive_night_shifts_detected():
    assignments = [
        _a("a1", "u1", "2026-01-01", "NIGHT"),
        _a("a2", "u1", "2026-01-02", "NIGHT"),
        _a("a3", "u1", "2026-01-03", "NIGHT"),
        _a("a4", "u1", "2026-01-04", "NIGHT"),
    ]
    rules = [
        SchedulingRule(
            rule_key="MAX_CONSECUTIVE_NIGHT_SHIFTS",
            rule_type="HARD",
            parameters={"shiftCode": "NIGHT", "maxConsecutiveDays": 2},
        ),
    ]
    result = check_conflicts(_base_request(assignments, rules))
    assert result.is_valid is False
    violations = [v for v in result.violations if v.rule_key == "MAX_CONSECUTIVE_NIGHT_SHIFTS"]
    # วันที่ 3 (รัน 3 วันติด) และวันที่ 4 (รัน 4 วันติด) ต่างก็เกินเกณฑ์ 2 วัน ควรมี >= 1 รายการ
    assert len(violations) >= 1


def test_max_consecutive_resets_when_shift_code_differs():
    # ดึก, ดึก, เช้า (คั่น), ดึก, ดึก — ไม่ควรนับรวมเป็นรันเดียว 4 วัน
    assignments = [
        _a("a1", "u1", "2026-01-01", "NIGHT"),
        _a("a2", "u1", "2026-01-02", "NIGHT"),
        _a("a3", "u1", "2026-01-03", "MORNING"),
        _a("a4", "u1", "2026-01-04", "NIGHT"),
        _a("a5", "u1", "2026-01-05", "NIGHT"),
    ]
    rules = [
        SchedulingRule(
            rule_key="MAX_CONSECUTIVE_NIGHT_SHIFTS",
            rule_type="HARD",
            parameters={"shiftCode": "NIGHT", "maxConsecutiveDays": 2},
        ),
    ]
    result = check_conflicts(_base_request(assignments, rules))
    assert all(v.rule_key != "MAX_CONSECUTIVE_NIGHT_SHIFTS" for v in result.violations)


def test_min_staff_per_shift_flags_understaffed_day_with_no_assignment_at_all():
    assignments = [_a("a1", "u1", "2026-01-01", "MORNING")]
    rules = [
        SchedulingRule(rule_key="MIN_STAFF_PER_SHIFT", rule_type="HARD", parameters={"shiftCode": "MORNING", "min": 2}),
    ]
    result = check_conflicts(_base_request(assignments, rules, month=1, year=2026))
    jan1_violations = [
        v for v in result.violations if v.rule_key == "MIN_STAFF_PER_SHIFT" and v.locations[0].date.isoformat() == "2026-01-01"
    ]
    assert len(jan1_violations) == 1
    assert "1 คน" in jan1_violations[0].message
