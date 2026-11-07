# ADR-0003: Multi-Tenant Strategy และ Authentication

**สถานะ:** Accepted
**วันที่:** Sprint 0
**อ้างอิง PRD:** NFR-05, NFR-02, TO-03, FR-A01/A02, CON-03, จุดตัดสินใจหัวข้อ 14 ("ขยายไปโรงพยาบาลอื่น")

## บริบท
NFR-05 ระบุ "รองรับ Multi-Ward, Multi-Department, Multi-Hospital (Multi-Tenant Architecture)" เป็น Should Have สำหรับ MVP แต่ PRD หัวข้อ 14 ระบุว่าการลงทุนเต็มรูปแบบอยู่ใน**ระยะขยายผล**เท่านั้น หากยังไม่มีแผนขยายไปโรงพยาบาลอื่นให้เลื่อนออกไปได้

## การตัดสินใจ

### Multi-Tenant
ใช้ **Shared Database, Shared Schema with `hospital_id` discriminator column** ตั้งแต่ Sprint 0 (ไม่ใช่ Database-per-tenant) เพราะ:
1. ขนาดที่ระบุ (สูงสุด 1,000 บุคลากรต่อโรงพยาบาล) ไม่จำเป็นต้องแยก Database ตั้งแต่แรก
2. ทุกตารางหลักมี `hospital_id` + Row-Level Security (PostgreSQL RLS) เป็นแนวป้องกันชั้นที่สองนอกจาก Application-layer filtering
3. เปิดทางขยายเป็น Database-per-tenant ในอนาคตได้โดยไม่ต้อง Redesign Schema (เพียง migrate ข้อมูลตาม `hospital_id`)
4. ตอบ CON-03 (Customize Rule Engine ต่อองค์กร) ได้ในตัว เพราะ `scheduling_rules` ผูกกับ `hospital_id` อยู่แล้ว

**ขอบเขต Sprint 0:** ออกแบบ Schema ให้พร้อมรองรับ Multi-Tenant (ใส่ `hospital_id` ทุกตารางที่เกี่ยวข้อง) แต่ **ยังไม่ทำ Hardening เต็มรูปแบบ** (Load test 1000 users, RLS policy ครบทุกตาราง) ซึ่งตรงกับ Sprint 19-20 ในระยะขยายผลตาม MVP_ExecutionPlan

### Authentication
- **JWT (Access Token 15 นาที) + Refresh Token Rotation** ตาม NFR-02
- **OAuth2.0**: Google, Microsoft (Azure AD), Facebook ตาม INT-03/04/05 — ใช้ Passport.js strategies ใน NestJS
- **Password Policy**: ขั้นต่ำ 8 ตัวอักษร ตัวเลข+อักษรพิเศษ (NFR-02) — validate ด้วย Zod schema ร่วมกับ Frontend
- **2FA สำหรับ Admin** (NFR-02) — TOTP (ใช้ `otplib`), บังคับเปิดสำหรับ Role `SuperAdmin` และ `WardAdmin`
- **RBAC**: 4 Role คงที่ตาม FR-A02 (`SuperAdmin`, `WardAdmin`, `HeadNurse`, `Nurse`) — ใช้ NestJS Guards + Decorator (`@Roles()`) ตรวจสิทธิ์ระดับ Endpoint, และ Policy-based check ระดับ Resource (เช่น HeadNurse แก้ไขได้เฉพาะ Ward ของตน)

## ผลที่ตามมา
- ทุก Query ต้อง inject `hospital_id` (และ `ward_id` สำหรับ HeadNurse) ผ่าน Request Context — ป้องกัน Data Leak ข้าม Tenant ตั้งแต่ชั้น Repository
- Audit Log (NFR-03) ต้องบันทึก `hospital_id`, `actor_id`, `role` ทุก record เพื่อ Traceability
