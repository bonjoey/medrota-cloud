# ADR-0002: สัญญา API ระหว่าง NestJS และ Python AI Service

**สถานะ:** Accepted
**วันที่:** Sprint 0
**อ้างอิง PRD:** หัวข้อ 8.1 (Scheduling Engine), RK-08, FR-AI01/AI02/AI03, FR-A10

## บริบท
RK-08 ระบุความเสี่ยงชัดเจนว่า "ระบบมี 2 ภาษา (NestJS และ Python) ทำให้ต้องดูแลสัญญา API ระหว่างกัน" และ PRD กำหนดแนวทางบรรเทาไว้แล้วว่า **ให้ Python เป็นเจ้าของตรรกะกฎเพียงที่เดียว (ทั้ง Solver และ FR-A10)** NestJS เก็บกฎเป็นข้อมูลและเรียกผ่านสัญญา JSON/OpenAPI ที่มีเทสต์สัญญา (Contract Test)

## การตัดสินใจ

### 1. แบ่งความรับผิดชอบ
| บริการ | เจ้าของ | หน้าที่ |
|---|---|---|
| **NestJS (`apps/api`)** | ข้อมูล + Workflow | เก็บ Scheduling Rules เป็นข้อมูล (PostgreSQL), Auth/RBAC, Workflow การอนุมัติ, Audit Log, เรียก Python ผ่าน HTTP |
| **Python (`services/ai`)** | ตรรกะกฎทั้งหมด | CP-SAT Solver (FR-AI01), Conflict Check (FR-A10) ใช้ Constraint Model เดียวกัน, Forecasting (FR-AI02), Fatigue Scoring (FR-AI03) |

**เหตุผลสำคัญ:** FR-A10 (ตรวจ Conflict ใน MVP 1) และ FR-AI01 Solver (MVP 2) ต้องใช้ **Constraint Model เดียวกัน** ตามที่ PRD เตือนไว้ในหัวข้อ 6 Sprint 2 ("ข้อควรระวังทางเทคนิค") — ถ้าแยกตรรกะกันจะเกิดกรณีที่ Conflict Checker บอกว่าผ่าน แต่ Solver บอกว่า Infeasible

### 2. รูปแบบการสื่อสาร
- **Synchronous (REST)**: สำหรับ Conflict Check (FR-A10) ที่ต้องตอบเร็ว (< 2s ตาม NFR-01)
- **Asynchronous (Job Queue)**: สำหรับ Solver (FR-AI01) และ Forecast training — NestJS ส่งงานเข้า Queue (Redis/BullMQ) → Python worker ดึงงาน → เขียนผลกลับ → NestJS poll ผ่าน Job ID ตาม API spec หัวข้อ 8.3 (`POST /ai/schedules/suggest` คืน Job ID, `GET /ai/schedules/suggest/{jobId}` ตรวจสถานะ)

### 3. สัญญา (Contract)
- กำหนด OpenAPI 3.0 spec ไว้ที่ `packages/shared/contracts/ai-service.openapi.yaml` เป็น Single Source of Truth
- Python service (FastAPI) generate schema จาก Pydantic models ให้ตรงกับสัญญานี้
- NestJS generate TypeScript client จากสัญญาเดียวกัน (`openapi-typescript`)
- **Contract Test**: ทุก PR ที่แก้ `services/ai` ต้องรัน schema diff เทียบกับ contract — ถ้าไม่ตรง build fail (CI, ดู docs/adr/0004)

### 4. รูปแบบข้อมูลกฎ (Rule Schema)
กฎทุกข้อเก็บเป็น JSON structure เดียวกันทั้งสองฝั่ง แยกชัดเจนเป็น `hard_constraints[]` และ `soft_constraints[]` พร้อม `weight` สำหรับ soft — ดู `packages/shared/schemas/scheduling-rule.schema.json`

## ผลที่ตามมา
- วัดเวลาเรียกบริการ (network latency ระหว่าง NestJS↔Python) เทียบกับ NFR-01 ต้องทำเป็น Spike ใน Sprint 0 จริง (งานนี้ยังไม่รวมใน scaffold — ต้องรันกับ Infra จริงก่อน Go-live)
- Python service ต้อง versioning Model Registry (FR-AI02 ขั้นที่ 5) แยกจาก code version
