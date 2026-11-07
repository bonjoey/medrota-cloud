"""FR-AI03 — API ตาม API Spec หัวข้อ 8.3"""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter

from app.schemas import FatigueScoreResult
from app.scoring.fatigue import ShiftRecord, compute_fatigue_score

router = APIRouter(prefix="/fatigue-score", tags=["fatigue"])


@router.get("")
def get_fatigue_score(ward_id: str, month: int) -> list[FatigueScoreResult]:
    """
    GET /api/v1/ai/fatigue-score?ward={id}&month={m}
    จำกัดสิทธิ์การเข้าถึงตามมาตรการใน FR-AI03 (Ethical Guardrails) — การบังคับสิทธิ์
    ระดับ Role ทำที่ชั้น NestJS (RolesGuard) ก่อนเรียกมาถึง endpoint นี้แล้ว
    """
    # Sprint 0 scaffold — ยังไม่ดึงข้อมูลจริงจาก Database (NestJS เป็นเจ้าของข้อมูล
    # ตาม ADR-0002; endpoint นี้คาดหวังว่า NestJS ส่ง records ที่ query แล้วมาให้
    # ใน Sprint 15 ของ MVP 5 ต้องเปลี่ยน signature ให้รับ records จริงเป็น body)
    _ = (ward_id, month)
    return []


def score_from_records(user_id: str, as_of: date, records: list[ShiftRecord], ward_type: str) -> FatigueScoreResult:
    return compute_fatigue_score(user_id=user_id, as_of=as_of, records=records, ward_type=ward_type)
