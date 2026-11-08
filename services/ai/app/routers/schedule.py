"""FR-AI01 — API ตาม API Spec หัวข้อ 8.3 (ทำงานแบบ Asynchronous Job)"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.schemas import ConflictCheckRequest, ConflictCheckResult, ScheduleSuggestRequest, ScheduleSuggestResult
from app.solver.constraint_model import check_conflicts, solve_schedule

router = APIRouter(prefix="/schedules", tags=["scheduling"])

# MVP 2 Sprint 5: เส้นทางจริงของ Production คือ NestJS ส่งงานเข้า Queue (Redis/BullMQ)
# โดยตรง แล้ว app/worker.py (Python) เป็นผู้ดึงงานไปประมวลผล — ไม่ผ่าน HTTP เลย (ดู
# ADR-0002 + docker-compose.yml service "ai-worker") 2 endpoint นี้ "/suggest" และ
# "/suggest/{job_id}" จึงไม่ได้ถูกเรียกจาก NestJS อีกต่อไปในโหมดใช้งานจริง — เหลือไว้
# เฉพาะสำหรับเรียกตรงด้วยมือ (manual/UAT smoke test) เท่านั้น ใช้ in-memory dict เดิม
# ซึ่งหายไปทุกครั้งที่ restart service (ยอมรับได้เพราะไม่ใช่ production path แล้ว)
_JOBS: dict[str, ScheduleSuggestResult] = {}


@router.post("/suggest")
def suggest_schedule(request: ScheduleSuggestRequest) -> dict[str, str]:
    """
    POST /api/v1/ai/schedules/suggest — รันแบบ synchronous ภายใน request เดียว
    สำหรับเรียกตรงด้วยมือเท่านั้น (ดูหมายเหตุด้านบน) ไม่ใช่เส้นทางที่ NestJS ใช้จริง
    """
    job_id = str(uuid.uuid4())
    result = solve_schedule(request)
    _JOBS[job_id] = result
    return {"job_id": job_id}


@router.get("/suggest/{job_id}")
def get_suggestion_result(job_id: str) -> ScheduleSuggestResult:
    """GET /api/v1/ai/schedules/suggest/{jobId} — ตรวจสถานะและรับผลตารางที่เสนอ"""
    result = _JOBS.get(job_id)
    if result is None:
        raise HTTPException(status_code=404, detail="ไม่พบ Job นี้")
    return result


@router.post("/check-conflicts")
def check_conflicts_endpoint(request: ConflictCheckRequest) -> ConflictCheckResult:
    """
    POST /api/v1/ai/schedules/check-conflicts — FR-A10 (MVP 1 Sprint 3)

    ทำงานแบบ Synchronous (ไม่ใช่ Job Queue เหมือน /suggest) เพราะเป็นการประเมินตรง
    ไม่ใช่การค้นหาคำตอบด้วย CP-SAT — เร็วพอให้ NestJS เรียกแบบ Sync ได้ตาม ADR-0002
    """
    return check_conflicts(request)
