"""
ทดสอบ FR-AI03 ชั้นที่ 1 — เกณฑ์ยอมรับตาม PRD หัวข้อ 5.4.5:
  - ตรวจจับ Quick Return และชุดเวรดึกที่เกินเกณฑ์ได้ครบถ้วน (ต้องไม่พลาด)
"""
from datetime import date, timedelta

from app.scoring.fatigue import ShiftRecord, compute_fatigue_score


def test_consecutive_night_shifts_detected():
    as_of = date(2026, 1, 10)
    records = [
        ShiftRecord(as_of - timedelta(days=i), "NIGHT", 8.0, True, True) for i in range(4)
    ]
    result = compute_fatigue_score("u1", as_of, records, ward_type="ICU")

    assert result.factors.consecutive_night_shifts == 4
    assert result.risk_level in ("WARNING", "CRITICAL")


def test_quick_return_detected():
    as_of = date(2026, 1, 10)
    records = [
        ShiftRecord(as_of - timedelta(days=1), "NIGHT", 8.0, True, True),
        ShiftRecord(as_of, "MORNING", 8.0, False, False),
    ]
    result = compute_fatigue_score("u2", as_of, records, ward_type="GENERAL")

    assert result.factors.quick_return_count >= 1


def test_estimate_flag_propagates():
    as_of = date(2026, 1, 10)
    result = compute_fatigue_score("u3", as_of, [], ward_type="GENERAL", is_estimate=True)
    assert result.is_estimate is True
    assert result.risk_level == "NORMAL"
