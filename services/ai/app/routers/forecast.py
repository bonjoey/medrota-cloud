"""
FR-AI02 — Patient Demand Forecasting (MVP 5)

PRD RK-07: "เริ่ม FR-AI02 ด้วยแบบจำลองฐานและประกาศค่าความคลาดเคลื่อนให้ผู้ใช้ทราบทุกครั้ง"
Sprint 0 scaffold นี้จึงใช้ Baseline (ค่าเฉลี่ยเคลื่อนที่ 4 สัปดาห์) ก่อน —
โมเดล LightGBM จริงตาม PRD หัวข้อ 5.4.4 ต้องรอข้อมูล Census ย้อนหลังจาก HIS (INT-06)
ซึ่งเป็นงานของ MVP 5 Sprint 17 ตาม MVP_ExecutionPlan
"""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import APIRouter

from app.schemas import ForecastPoint, ForecastRequest, ForecastResponse

router = APIRouter(prefix="/forecast", tags=["forecast"])


def _baseline_forecast(historical_adc: list[float], horizon_days: int) -> list[tuple[float, float]]:
    """ค่าเฉลี่ยย้อนหลัง 4 สัปดาห์ (28 วัน) เป็น P50, บวก 1 ส่วนเบี่ยงเบนมาตรฐานเป็น P90 โดยประมาณ"""
    if not historical_adc:
        return [(0.0, 0.0)] * horizon_days
    window = historical_adc[-28:] if len(historical_adc) >= 28 else historical_adc
    mean = sum(window) / len(window)
    variance = sum((v - mean) ** 2 for v in window) / len(window)
    std = variance**0.5
    p50 = mean
    p90 = mean + 1.2816 * std  # ประมาณ percentile 90 ของการกระจายแบบปรกติ
    return [(p50, p90)] * horizon_days


@router.get("")
def get_forecast(ward_id: str, horizon_days: int = 30) -> ForecastResponse:
    """GET /api/v1/ai/forecast?ward={id}&horizon={days}"""
    # Sprint 0 scaffold: ข้อมูลย้อนหลังจริงต้องมาจาก NestJS (ซึ่งดึงจาก HIS ผ่าน INT-06)
    # ที่นี่ใช้ placeholder เปล่าเพื่อให้ endpoint ตอบ contract ได้ครบ
    historical_adc: list[float] = []
    today = date.today()
    pairs = _baseline_forecast(historical_adc, horizon_days)

    points = [
        ForecastPoint(
            date=today + timedelta(days=i + 1),
            p50=round(p50, 1),
            p90=round(p90, 1),
            required_fte={"RN": 0, "PN": 0, "NA": 0},  # TODO: แปลงจาก Nurse-to-Patient Ratio (FR-A05/A07)
        )
        for i, (p50, p90) in enumerate(pairs)
    ]

    return ForecastResponse(
        ward_id=ward_id,
        model_version="baseline-moving-average-v0",
        points=points,
        feature_importance={},
    )
