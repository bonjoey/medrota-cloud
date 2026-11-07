# ADR-0001: Frontend Framework — Next.js + Tailwind CSS

**สถานะ:** Accepted
**วันที่:** Sprint 0
**อ้างอิง PRD:** หัวข้อ 8.1 (เสนอ React.js/Next.js — เฟรมเวิร์กสุดท้ายตาม ADR ใน Sprint 0), NFR-07, TO-04, CON-05

## บริบท
PRD กำหนดให้ระบบเป็น Web Application แบบ Responsive, Mobile-First, ไม่พัฒนา Native App (ตัดสินแล้วใน CON-05 เพื่อควบคุมขนาดทีมและงบประมาณ) ต้องรองรับ Browser หลัก 2 เวอร์ชันล่าสุด และ iOS 14+/Android 10+ ผ่านเบราว์เซอร์ (NFR-07)

## การตัดสินใจ
ใช้ **Next.js 14+ (App Router) + TypeScript + Tailwind CSS** สำหรับ `apps/web` เป็น Web Application เดียวที่ใช้งานได้ทั้ง Desktop/Tablet/Mobile ผ่านเบราว์เซอร์

เหตุผล:
1. **SSR/SSG ในตัว** — เหมาะกับ Dashboard ที่ต้องโหลดเร็ว (NFR-01: Response Time < 2s) และ SEO ไม่สำคัญแต่ Time-to-Interactive สำคัญสำหรับผู้ใช้มือถือ (P-04 พยาบาลใช้มือถือเป็นหลัก)
2. **File-based routing + React Server Components** ลดความซับซ้อนของทีม Frontend ขนาดเล็ก (1-2 คนตาม MVP_ExecutionPlan หัวข้อ 2)
3. **Tailwind CSS** ทำให้ Design System (Mobile-First, WCAG 2.1 AA, Contrast ≥ 4.5:1 ตามหัวข้อ 7.1) คุมได้จาก config เดียว ง่ายต่อการคง Consistency ข้ามหน้าจอจำนวนมาก (Grid ตารางเวร, Calendar, Dashboard, Approval Workflow)
4. **Ecosystem รองรับ Realtime** — ใช้ร่วมกับ WebSocket client (socket.io-client) สำหรับ Notification แบบ Real-time จาก NestJS (ตามหัวข้อ 8.1)

## State Management
- Server state: **TanStack Query** (React Query) สำหรับ cache ข้อมูลจาก REST API
- Client/UI state: React Context + `useState`/`useReducer` สำหรับ state เฉพาะหน้า (เช่น Drag-and-drop grid)
- ฟอร์ม: **React Hook Form + Zod** (Zod schema ใช้ร่วมกับ validation ฝั่ง NestJS ผ่าน `packages/shared`)

## ผลที่ตามมา
- ต้องตั้ง Design Token กลางใน `packages/shared/design-tokens` เพื่อให้ Storybook/Component library ใช้ร่วมกัน
- i18n (ไทย/อังกฤษ ตามหัวข้อ 7.1) ใช้ `next-intl`
