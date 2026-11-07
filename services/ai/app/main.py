from fastapi import FastAPI

from app.routers import fatigue, forecast, schedule

app = FastAPI(
    title="MedRota Cloud — AI Service",
    description=(
        "FR-AI01 Scheduling Engine (CP-SAT), FR-AI02 Demand Forecasting, "
        "FR-AI03 Fatigue Scoring — ดู ADR-0002 สำหรับขอบเขตเทียบกับ NestJS apps/api"
    ),
    version="0.1.0",
)

app.include_router(schedule.router, prefix="/api/v1/ai")
app.include_router(forecast.router, prefix="/api/v1/ai")
app.include_router(fatigue.router, prefix="/api/v1/ai")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
