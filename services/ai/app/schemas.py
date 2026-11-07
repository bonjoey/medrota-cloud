"""
Pydantic schemas — เป็น Single Source of Truth ของสัญญา API ร่วมกับ NestJS
ตาม ADR-0002 (packages/shared/contracts/ai-service.openapi.yaml ต้อง sync กับไฟล์นี้)
"""
from __future__ import annotations

from datetime import date
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class RuleType(str, Enum):
    HARD = "HARD"
    SOFT = "SOFT"


class SchedulingRule(BaseModel):
    """FR-A07: กฎระเบียบเวร — รูปแบบต้องตรงกับ Prisma model SchedulingRule.parameters"""

    rule_key: str
    rule_type: RuleType
    parameters: dict[str, Any]
    weight: float | None = None  # เฉพาะ SOFT


class StaffMember(BaseModel):
    user_id: str
    position_level: str  # RN | PN | NA
    ward_id: str


class RequiredFte(BaseModel):
    date: date
    shift_type_code: str
    rn: int
    pn: int
    na: int


class ScheduleSuggestRequest(BaseModel):
    """FR-AI01: Input ของ POST /ai/schedules/suggest"""

    hospital_id: str
    ward_id: str
    month: int = Field(ge=1, le=12)
    year: int
    staff: list[StaffMember]
    shift_types: list[dict[str, Any]]
    rules: list[SchedulingRule]
    approved_leaves: list[dict[str, Any]] = []
    required_fte: list[RequiredFte] = []  # จาก FR-AI02 ถ้ามี, ไม่มีก็ fallback เป็นนโยบายขั้นต่ำจาก rules
    fatigue_scores: dict[str, float] = {}  # user_id -> score ล่าสุด (Soft Constraint วงจรปิด)
    objective_weights: dict[str, float] = {}  # ผู้บริหารปรับได้ (PRD ขั้นที่ 2)
    time_limit_seconds: int = 60  # เกณฑ์ยอมรับ: ≤60s สำหรับ 80คน x 31วัน


class AssignmentExplanation(BaseModel):
    """AIP-01: Explainability — ทุกช่องต้องอธิบายได้"""

    user_id: str
    date: date
    shift_type_code: str
    reasons: list[str]
    change_impact_if_swapped: str | None = None


class InfeasibleReason(BaseModel):
    """AIP-01: กรณี Infeasible ต้องระบุเงื่อนไขที่ขัดแย้งกันอย่างชัดเจน (BP-01 EX-1)"""

    conflicting_rule_keys: list[str]
    explanation: str
    suggested_relaxations: list[str]


class QualityScore(BaseModel):
    fairness_index: float
    gini_coefficient: float  # เกณฑ์ยอมรับ ≤ 0.15
    predicted_total_ot_hours: float
    personal_preference_satisfaction_rate: float | None = None


class ScheduleSuggestResult(BaseModel):
    """FR-AI01: Output — ตารางเวร Draft พร้อมคำอธิบายเหตุผลรายช่อง"""

    status: str  # "FEASIBLE" | "INFEASIBLE" | "TIMEOUT_BEST_EFFORT"
    assignments: list[AssignmentExplanation] = []
    quality_score: QualityScore | None = None
    infeasible_reason: InfeasibleReason | None = None
    solve_time_seconds: float = 0.0


class ConflictCheckAssignment(BaseModel):
    """FR-A10: 1 ช่องของตารางที่กำลังตรวจ (มาจาก ScheduleAssignment ฝั่ง NestJS)"""

    assignment_id: str
    user_id: str
    date: date
    shift_type_code: str


class ConflictCheckRequest(BaseModel):
    """
    FR-A10: Input ของ POST /ai/schedules/check-conflicts

    หมายเหตุ (ADR-0002): reuse ruleKey/parameters ชุดเดียวกับ ScheduleSuggestRequest
    เพื่อไม่ให้มีตรรกะกฎสองชุดที่ตีความต่างกัน — ต่างกันแค่ Mode (ตรวจของที่มีอยู่แล้ว
    เทียบกับค้นหาคำตอบใหม่)
    """

    hospital_id: str
    ward_id: str
    month: int = Field(ge=1, le=12)
    year: int
    assignments: list[ConflictCheckAssignment]
    shift_types: list[dict[str, Any]]
    rules: list[SchedulingRule]
    approved_leaves: list[dict[str, Any]] = []


class ConflictLocation(BaseModel):
    """ตำแหน่งบน Grid ที่ต้องชี้ให้ผู้ใช้เห็น (AIP-01 + FR-A10 UI requirement)"""

    assignment_id: str | None = None
    user_id: str
    date: date
    shift_type_code: str | None = None


class ConflictViolation(BaseModel):
    rule_key: str
    message: str
    locations: list[ConflictLocation]


class ConflictCheckResult(BaseModel):
    """FR-A10: Output — รายการข้อขัดแย้งทั้งหมด พร้อมตำแหน่งชี้บน Grid"""

    is_valid: bool
    violations: list[ConflictViolation] = []


class ForecastRequest(BaseModel):
    """FR-AI02: Input ของ GET /ai/forecast"""

    hospital_id: str
    ward_id: str
    horizon_days: int = 30


class ForecastPoint(BaseModel):
    date: date
    p50: float
    p90: float
    required_fte: dict[str, int]  # {"RN": 5, "PN": 2, "NA": 1}


class ForecastResponse(BaseModel):
    ward_id: str
    model_version: str
    points: list[ForecastPoint]
    feature_importance: dict[str, float] = {}


class FatigueFactors(BaseModel):
    """FR-AI03 ชั้นที่ 1: breakdown ตามปัจจัยในตาราง PRD 5.4.5"""

    cumulative_hours_7d: float
    cumulative_hours_14d: float
    cumulative_hours_28d: float
    consecutive_night_shifts: int
    quick_return_count: int
    rotation_direction_penalty: float
    circadian_low_exposure: float
    recovery_days_after_night_block: int


class FatigueScoreResult(BaseModel):
    user_id: str
    score_date: date
    score: int = Field(ge=0, le=100)
    factors: FatigueFactors
    risk_level: str  # NORMAL | WARNING | CRITICAL
    is_estimate: bool = False
