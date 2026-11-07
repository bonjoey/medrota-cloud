# ADR-0004: CI/CD Pipeline และ Testing Strategy

**สถานะ:** Accepted
**วันที่:** Sprint 0
**อ้างอิง PRD:** NFR-06, Definition of Done (MVP_ExecutionPlan หัวข้อ 3)

## บริบท
Definition of Done ทุก Sprint กำหนดว่า: Code Coverage รวม ≥ 70% (NFR-06), Deploy ขึ้น UAT ได้ด้วย Pipeline โดยไม่ต้องทำด้วยมือ, Audit Log ครบทุก Transaction

## การตัดสินใจ

### Environments
`Dev → UAT → Production` แยกกันตั้งแต่จบ Sprint 0 (ตามสมมติฐานแผนหัวข้อ 1) — แต่ละ environment มี Database แยก, secrets แยก

### Pipeline (GitHub Actions)
1. **On PR**: Lint (ESLint/Prettier สำหรับ TS, Ruff/Black สำหรับ Python) → Unit Test → Contract Test (ดู ADR-0002) → Build
2. **On merge to `main`**: Build → Push Docker image → Deploy to UAT อัตโนมัติ
3. **Production**: Manual approval gate (Release Readiness Review ตาม MVP_ExecutionPlan หัวข้อ 4)

### Testing Layers
| ชั้น | เครื่องมือ | ครอบคลุม |
|---|---|---|
| Unit | Jest (NestJS/Next.js), Pytest (Python) | Business logic, Constraint calculation, Fatigue formula |
| Integration | Jest + Testcontainers (PostgreSQL/Redis) | Repository layer, Multi-tenant isolation |
| Contract | Dredd / Schemathesis เทียบ OpenAPI spec | NestJS↔Python boundary (ADR-0002) |
| E2E | Playwright | Happy Path หัวข้อ 7.3 (Flow 1, Flow 2) |

### Code Coverage Gate
CI บังคับ coverage ≥ 70% รวมทั้ง repo ตาม NFR-06 — PR ที่ทำให้ coverage ต่ำกว่าเกณฑ์ไม่ผ่าน CI

## ผลที่ตามมา
- ต้องเตรียม Testcontainers ใน CI runner (Docker-in-Docker) — เพิ่มเวลา pipeline ราว 1-2 นาที แลกกับความถูกต้องของ Integration test ที่ทดสอบกับ PostgreSQL จริงไม่ใช่ mock
