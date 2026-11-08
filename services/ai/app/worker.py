"""
MVP 2 Sprint 5 — BullMQ Worker (FR-AI01)

ตาม ADR-0002 หัวข้อ 2 ("Asynchronous (Job Queue)"): NestJS (`apps/api`) ส่งงานเข้า Queue
"ai-jobs" บน Redis โดยตรงด้วย npm package `bullmq` — ไฟล์นี้คือฝั่ง Python ที่ "ดึงงาน"
จาก Queue เดียวกันนั้นโดยตรง (ไม่ผ่าน HTTP เลย) ใช้ package `bullmq` (PyPI) ซึ่งพูดโปรโตคอล
เดียวกับฝั่ง Node (ใช้ .lua script ชุดเดียวกัน) จึงทำงานร่วมกันได้แบบ cross-language จริง

สัญญาของ Job (ต้องตรงกับฝั่ง NestJS AiJob module — MVP 2 Sprint 5/ADR-0002):
  - job.name  = ค่าใน Prisma enum AiJobType ("SCHEDULE_SUGGEST" | "INCREMENTAL_RESOLVE" |
                "FORECAST_TRAIN" | "FATIGUE_BATCH")
  - job.data  = {"ai_job_id": "<Prisma AiJob.id>", "payload": {...}}
                payload ของ SCHEDULE_SUGGEST/INCREMENTAL_RESOLVE ตรงกับ
                ScheduleSuggestRequest ทุกฟิลด์ (INCREMENTAL_RESOLVE ส่ง fixed_assignments
                + resolve_window มาด้วยเสมอ ส่วน SCHEDULE_SUGGEST ปล่อยทั้งสองฟิลด์เป็นค่าเริ่มต้น)
  - คืนค่า (return value ของ processor) = ผลลัพธ์ JSON-serializable ที่ NestJS จะอ่านผ่าน
    BullMQ Job.returnvalue เมื่อ poll เจอสถานะ "completed" แล้วค่อยเขียนลง Postgres
    AiJob.resultPayload เอง (NestJS เป็นเจ้าของข้อมูล — Python ไม่แตะ Postgres ตรง ๆ
    ตาม ADR-0002 หัวข้อ 1 ตารางแบ่งความรับผิดชอบ)
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal

from bullmq import Worker
from bullmq.custom_errors import UnrecoverableError
from pydantic import ValidationError

from app.schemas import ScheduleSuggestRequest
from app.solver.constraint_model import solve_schedule

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ai-worker")

QUEUE_NAME = os.environ.get("AI_JOB_QUEUE_NAME", "ai-jobs")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
WORKER_CONCURRENCY = int(os.environ.get("AI_WORKER_CONCURRENCY", "2"))

# MVP 2 Sprint 5-8 รองรับเฉพาะ FR-AI01 (Scheduling) — FORECAST_TRAIN (FR-AI02) และ
# FATIGUE_BATCH (FR-AI03) เป็น AiJobType ที่ Sprint 0 scaffold เผื่อไว้ล่วงหน้าสำหรับ MVP
# ถัดไป ยังไม่มี Logic จริงในชั้นนี้ — ถ้ามีงานประเภทนี้เข้ามาให้ Fail แบบ Unrecoverable
# ทันที (ไม่ Retry เปล่าประโยชน์) พร้อมข้อความที่ชัดเจนว่าเป็นเพราะยังไม่ถึง Sprint ของมัน
SUPPORTED_JOB_TYPES = {"SCHEDULE_SUGGEST", "INCREMENTAL_RESOLVE"}


async def process(job, job_token: str) -> dict:
    ai_job_id = (job.data or {}).get("ai_job_id", "?")
    logger.info("รับงาน job.id=%s ai_job_id=%s type=%s", job.id, ai_job_id, job.name)

    if job.name not in SUPPORTED_JOB_TYPES:
        raise UnrecoverableError(
            f"Job type '{job.name}' ยังไม่รองรับใน MVP 2 Sprint 5-8 "
            "(รองรับเฉพาะ SCHEDULE_SUGGEST, INCREMENTAL_RESOLVE)"
        )

    payload = (job.data or {}).get("payload")
    if payload is None:
        raise UnrecoverableError("job.data.payload ขาดหายไป — รูปแบบ Job ไม่ตรงสัญญา ADR-0002")

    try:
        request = ScheduleSuggestRequest(**payload)
    except ValidationError as exc:
        # ข้อมูล Input ผิดรูปแบบ — Retry ใหม่ก็ไม่มีทางสำเร็จ ให้ Fail ทันทีแบบ Unrecoverable
        raise UnrecoverableError(f"payload ไม่ตรงสัญญา ScheduleSuggestRequest: {exc}") from exc

    if job.name == "INCREMENTAL_RESOLVE" and request.resolve_window is None:
        raise UnrecoverableError("INCREMENTAL_RESOLVE ต้องส่ง resolve_window มาด้วยเสมอ")

    # CP-SAT (ortools) เป็นโค้ด C++ ที่ปล่อย GIL ระหว่างค้นหาคำตอบ จึงรันตรงใน event loop
    # ของ asyncio ได้โดยไม่บล็อก worker อื่นมากเกินไป (ต่างจากโค้ด Python ล้วนที่ CPU-bound)
    result = solve_schedule(request)
    logger.info(
        "งานเสร็จ job.id=%s ai_job_id=%s status=%s solve_time=%.2fs",
        job.id,
        ai_job_id,
        result.status,
        result.solve_time_seconds,
    )
    return result.model_dump(mode="json")


async def main() -> None:
    logger.info("เริ่ม AI Worker: queue=%s redis=%s concurrency=%d", QUEUE_NAME, REDIS_URL, WORKER_CONCURRENCY)
    worker = Worker(
        QUEUE_NAME,
        process,
        {
            "connection": REDIS_URL,
            "concurrency": WORKER_CONCURRENCY,
            # เผื่อเวลาพอสำหรับ 80 คน x 31 วัน (เกณฑ์ NFR-01 ≤60s) + กันเวลาผิดพลาดของ Redis
            "lockDuration": 120_000,
        },
    )

    shutdown_event = asyncio.Event()

    def _handle_shutdown_signal(*_args: object) -> None:
        logger.info("ได้รับสัญญาณปิดระบบ — กำลัง Graceful Shutdown...")
        shutdown_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _handle_shutdown_signal)

    await shutdown_event.wait()
    logger.info("กำลังปิด Worker...")
    await worker.close()
    logger.info("ปิด Worker สำเร็จ")


if __name__ == "__main__":
    asyncio.run(main())
