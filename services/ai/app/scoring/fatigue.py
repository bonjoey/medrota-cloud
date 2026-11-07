"""
FR-AI03 ชั้นที่ 1 — Fatigue Score แบบคำนวณตามเกณฑ์ (ใช้ได้ตั้งแต่วันแรก ไม่ต้องรอข้อมูลฝึกโมเดล)

ปัจจัยและเหตุผลเชิงวิชาการตาม PRD หัวข้อ 5.4.5:
  - ชั่วโมงทำงานสะสม 7/14/28 วัน (Sleep Debt)
  - จำนวนเวรดึกติดต่อกัน
  - ช่วงพักที่สั้นเกินเกณฑ์ (Quick Return)
  - ทิศทางการหมุนเวร (ไปข้างหน้ารบกวนนาฬิกาชีวิตน้อยกว่าย้อนกลับ)
  - การทำงานในช่วงนาฬิกาชีวิตต่ำสุด (02:00-06:00)
  - วันพักฟื้นหลังชุดเวรดึก

ค่าน้ำหนักเริ่มต้นด้านล่างเป็นค่าตั้งต้นสำหรับ Sprint 0 — ต้อง "สอบเทียบ (Calibrate)
กับบริบทของโรงพยาบาลในช่วง Sprint 0" ตามที่ PRD ระบุไว้ชัดเจน ห้ามถือเป็นค่าสุดท้าย
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from app.schemas import FatigueFactors, FatigueScoreResult

# ค่าน้ำหนักตั้งต้น (placeholder) — ต้องสอบเทียบจริงกับหัวหน้าตึกใน Sprint 0
# (ดู MVP_ExecutionPlan_v1.0.md หัวข้อ 5: "สอบเทียบปัจจัยและน้ำหนักของ Fatigue Score กับหัวหน้าตึก")
DEFAULT_WEIGHTS = {
    "cumulative_hours_28d": 0.20,
    "consecutive_night_shifts": 0.30,
    # PRD ระบุ Quick Return เป็น "ปัจจัยเสี่ยงที่รุนแรงที่สุดปัจจัยหนึ่ง" จึงให้น้ำหนักสูงเท่าเวรดึกติดกัน
    "quick_return_count": 0.30,
    "rotation_direction_penalty": 0.10,
    "circadian_low_exposure": 0.05,
    "recovery_days_after_night_block": -0.15,  # ยิ่งมีวันพักฟื้นมาก คะแนนความเสี่ยงยิ่งลด
}

# เกณฑ์เตือนแยกตามประเภทหอผู้ป่วย (ตั้งต้น — สอบเทียบจริงใน Sprint 0 เช่นเดียวกับน้ำหนัก)
RISK_THRESHOLDS = {
    "ICU": {"WARNING": 60, "CRITICAL": 80},
    "ER": {"WARNING": 60, "CRITICAL": 80},
    "GENERAL": {"WARNING": 65, "CRITICAL": 85},
    "OTHER": {"WARNING": 65, "CRITICAL": 85},
}


@dataclass
class ShiftRecord:
    shift_date: date
    shift_code: str
    hours: float
    crosses_midnight: bool
    is_night: bool


def _consecutive_night_shifts(records: list[ShiftRecord], as_of: date) -> int:
    count = 0
    d = as_of
    by_date = {r.shift_date: r for r in records}
    while d in by_date and by_date[d].is_night:
        count += 1
        d -= timedelta(days=1)
    return count


def _quick_return_count(records: list[ShiftRecord], window_days: int = 28, min_rest_hours: float = 11.0) -> int:
    """นับจำนวนครั้งที่พักระหว่างเวรสั้นกว่าเกณฑ์ขั้นต่ำในช่วง window"""
    sorted_records = sorted(records, key=lambda r: r.shift_date)
    count = 0
    for i in range(1, len(sorted_records)):
        prev, curr = sorted_records[i - 1], sorted_records[i]
        gap_days = (curr.shift_date - prev.shift_date).days
        if gap_days > 1:
            continue
        # ประมาณคร่าวๆ: เวรข้ามเที่ยงคืนจบ 08:00, ถ้าเวรถัดไปเริ่มเช้าวันถัดไปถือเป็น Quick Return
        if prev.crosses_midnight and gap_days <= 1:
            count += 1
    return count


def _recovery_days_after_night_block(records: list[ShiftRecord], as_of: date) -> int:
    """
    นับวันพักที่ "เกิดขึ้นแล้วจริง" หลังจบชุดเวรดึกครั้งล่าสุด จนถึง as_of
    (นับย้อนหลัง ไม่ใช่คาดเดาไปข้างหน้า — ถ้าเวรดึกล่าสุดคือวันนี้หรือยังไม่จบ
    ชุด ต้องคืน 0 เพราะยังไม่เริ่มพักจริง ป้องกันบั๊กที่เคยให้เครดิตพักฟื้นผิดพลาด
    กับคนที่กำลังอยู่กลางชุดเวรดึกต่อเนื่อง)
    """
    night_dates = sorted(r.shift_date for r in records if r.is_night)
    if not night_dates:
        return 0

    last_night = night_dates[-1]
    if last_night >= as_of:
        return 0  # ยังอยู่ในชุดเวรดึก (หรือเวรดึกล่าสุดคือวันนี้) — ยังไม่เริ่มพักฟื้น

    worked_dates = {r.shift_date for r in records}
    d = last_night + timedelta(days=1)
    count = 0
    while d <= as_of and d not in worked_dates and count < 7:
        count += 1
        d += timedelta(days=1)
    return count


def compute_fatigue_score(
    user_id: str,
    as_of: date,
    records: list[ShiftRecord],
    ward_type: str = "GENERAL",
    is_estimate: bool = False,
    weights: dict[str, float] | None = None,
) -> FatigueScoreResult:
    w = weights or DEFAULT_WEIGHTS

    def hours_in_window(days: int) -> float:
        cutoff = as_of - timedelta(days=days)
        return sum(r.hours for r in records if cutoff < r.shift_date <= as_of)

    factors = FatigueFactors(
        cumulative_hours_7d=hours_in_window(7),
        cumulative_hours_14d=hours_in_window(14),
        cumulative_hours_28d=hours_in_window(28),
        consecutive_night_shifts=_consecutive_night_shifts(records, as_of),
        quick_return_count=_quick_return_count(records),
        rotation_direction_penalty=0.0,  # TODO: ต้องมีลำดับเวรก่อนหน้าเพื่อคำนวณทิศทางหมุนจริง
        circadian_low_exposure=sum(1 for r in records if r.is_night and r.shift_date == as_of),
        recovery_days_after_night_block=_recovery_days_after_night_block(records, as_of),
    )

    # Normalize แบบง่าย (0-100) — ชั้นนี้เป็น Baseline ตั้งต้น ต้องปรับสูตร Normalize จริง
    # ร่วมกับหัวหน้าตึกใน Sprint 0 ตามค่าฐานการทำงานจริงของ Ward นำร่อง
    raw_score = (
        w["cumulative_hours_28d"] * min(factors.cumulative_hours_28d / 200, 1.0) * 100
        # อิ่มตัว (saturate) ที่ 3 คืนติดกัน — PRD: ความเสี่ยงเพิ่มขึ้นมีนัยสำคัญตั้งแต่หลายคืนต่อเนื่อง
        + w["consecutive_night_shifts"] * min(factors.consecutive_night_shifts / 3, 1.0) * 100
        + w["quick_return_count"] * min(factors.quick_return_count / 3, 1.0) * 100
        + w["rotation_direction_penalty"] * factors.rotation_direction_penalty * 100
        + w["circadian_low_exposure"] * min(factors.circadian_low_exposure, 1.0) * 100
        + w["recovery_days_after_night_block"] * min(factors.recovery_days_after_night_block / 3, 1.0) * 100
    )
    score = max(0, min(100, round(raw_score)))

    thresholds = RISK_THRESHOLDS.get(ward_type, RISK_THRESHOLDS["OTHER"])
    if score >= thresholds["CRITICAL"]:
        risk_level = "CRITICAL"
    elif score >= thresholds["WARNING"]:
        risk_level = "WARNING"
    else:
        risk_level = "NORMAL"

    return FatigueScoreResult(
        user_id=user_id,
        score_date=as_of,
        score=score,
        factors=factors,
        risk_level=risk_level,
        is_estimate=is_estimate,
    )
