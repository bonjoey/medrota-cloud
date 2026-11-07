# MedRota Cloud — บริหารจัดการเวรโรงพยาบาล

แพลตฟอร์มบริหารจัดการเวรโรงพยาบาล พร้อม AI 3 ฟังก์ชันที่ทำงานเป็นวงจรปิด: คาดการณ์ความต้องการกำลังคน (FR-AI02) → จัดเวรอัจฉริยะที่อธิบายได้ (FR-AI01) → ประเมินความเสี่ยงความเหนื่อยล้า (FR-AI03)

**เอกสารต้นทาง:** [`docs/requirements/PRD_MedRotaCloud_v1.0.md`](docs/requirements/PRD_MedRotaCloud_v1.0.md), [`docs/requirements/MVP_ExecutionPlan_v1.0.md`](docs/requirements/MVP_ExecutionPlan_v1.0.md)

**สถานะ:** Sprint 0 — Foundation & Discovery (ดู [`docs/adr/`](docs/adr/) สำหรับการตัดสินใจทางสถาปัตยกรรม)

## โครงสร้าง Monorepo

```
apps/web         Next.js 14 + Tailwind (ADR-0001) — Web App เดียวสำหรับ Desktop/Tablet/Mobile
apps/api         NestJS — Auth/RBAC, Workflow, Audit Log, เก็บกฎเวรเป็นข้อมูล (ADR-0002, ADR-0003)
services/ai      Python FastAPI — CP-SAT Solver (FR-AI01), Forecast (FR-AI02), Fatigue Scoring (FR-AI03)
packages/shared  Types/Zod schema/OpenAPI contract ที่ใช้ร่วมกันทั้ง 3 service (ADR-0002)
docs/adr/        Architecture Decision Records
docs/requirements/  PRD และ MVP Execution Plan ต้นฉบับ
```

## เริ่มต้นใช้งาน (Dev)

### 1. Infra (PostgreSQL, Redis)
```bash
docker compose up -d postgres redis
```

### 2. Backend (NestJS)
```bash
cd apps/api
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run start:dev          # http://localhost:4000
```

### 3. AI Service (Python)
```bash
cd services/ai
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
pytest -v                  # รัน Unit Test ของ FR-AI01/FR-AI03
```

### 4. Frontend (Next.js)
```bash
cd apps/web
cp .env.example .env
npm install
npm run dev                 # http://localhost:3000
```

## สถานะความครบถ้วนของ Sprint 0

| งาน | สถานะ |
|---|---|
| Monorepo scaffold (web/api/ai/shared) | ✅ |
| Database Schema เต็มระบบ (Prisma) | ✅ ครอบคลุม FR-A01 ถึง FR-AI03 ทั้งหมด |
| ADR: Frontend, NestJS↔Python Contract, Multi-tenant/Auth, CI/CD | ✅ 4 ฉบับ |
| Auth (JWT) + RBAC 4 บทบาท + Audit Log scaffold | ✅ |
| CP-SAT Solver skeleton (FR-AI01) พร้อม Infeasibility diagnosis | ✅ มี Unit Test ผ่านครบ (6/6) |
| Fatigue Scoring ชั้นที่ 1 (FR-AI03) | ✅ มี Unit Test ผ่านครบ |
| Forecast baseline (FR-AI02) | ✅ Baseline เท่านั้น — โมเดล LightGBM จริงรอข้อมูล HIS (MVP 5) |
| Docker-compose dev environment | ✅ |
| CI/CD Pipeline (GitHub Actions) | ✅ Skeleton — ยังไม่ผ่านการรันจริงบน GitHub (ดู "งานที่เหลือ") |
| Workshop ยืนยันกฎระเบียบเวรจริงกับหัวหน้าตึก | ❌ ต้องทำกับคนจริง ไม่ใช่งานเขียนโค้ด |
| Spike API ระบบลงเวลางาน/HIS จริง | ❌ รอข้อมูล Vendor จริง (ดู Open Items) |
| DPIA ร่าง | ❌ งานเอกสาร ไม่ใช่งานเขียนโค้ด |

## Open Items — รอข้อมูลจริงก่อนความแม่นยำสมบูรณ์

เอกสาร PRD มีช่องที่ยังเป็น placeholder ซึ่งกระทบ Integration จริง (ไม่กระทบการเริ่ม Sprint 0/MVP1):

- `[ระบุ Vendor ระบบลงเวลางาน]` (INT-01, CON-01)
- `[ระบุ HIS ที่ใช้]` (INT-06)
- `[ระบุ SMS Gateway: Twilio/DTAC/True]` (INT-07)
- `[ระบุระบบ HR/Payroll]` (INT-02)
- ค่าน้ำหนัก Fatigue Score และเกณฑ์เตือน — เป็นค่าตั้งต้นใน `services/ai/app/scoring/fatigue.py`, **ต้องสอบเทียบกับหัวหน้าตึกจริงใน Sprint 0**

## ถัดไป

MVP 1 Sprint 1 (ตาม `MVP_ExecutionPlan_v1.0.md` หัวข้อ 6): จัดการผู้ใช้งาน, RBAC, Ward/Department, Authentication พื้นฐาน — โมดูล `users` และ `wards` ใน `apps/api` เริ่มไว้แล้วใน Sprint 0 scaffold นี้
