"""FR-AI01 — API ตาม API Spec หัวข้อ 8.3 (ทำงานแบบ Asynchronous Job)"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.schemas import ConflictCheckRequest, ConflictCheckResult, ScheduleSuggestRequest, ScheduleSuggestResult
from app.solver.constraint_model import check_conflicts, solve_schedule

router = APIRouter(prefix="/schedules", tags=["scheduling"])

# Sprint 0/5 scaffold: เก็บ Job ใน memory ก่อน — Production ต้องย้ายไป Redis/BullMQ
# ตาม ADR-0002 (NestJS ส่งงาน, Python worker ดึงงานจาก Queue จริง)
_JOBS: dict[str, ScheduleSuggestResult] = {}


@router.post("/suggest")
def suggest_schedule(request: ScheduleSuggestRequest) -> dict[str, str]:
    """
    POST /api/v1/ai/schedules/suggest — คืนค่าเป็น Job ID แบบ Asynchronous
    (scaffold นี้ยังรันแบบ synchronous ภายใน request เดียวเพื่อความง่ายของ Sprint 0;
    ก่อนขึ้น MVP 2 Sprint 5 ต้องย้ายเป็น background worker จริงตาม ADR-0002)
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
