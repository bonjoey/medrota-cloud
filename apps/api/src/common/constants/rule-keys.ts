/**
 * FR-A07: Catalog ของ ruleKey ที่รองรับจริง — ต้องตรงกับ HardConstraintBuilder ใน
 * services/ai/app/solver/constraint_model.py เป๊ะ ๆ (ADR-0002: ห้ามมีตรรกะกฎสองชุด
 * ที่อาจตีความ ruleKey/parameters ต่างกัน) ดังนั้นไฟล์นี้คือ Single Source of Truth
 * ฝั่ง NestJS ที่ใช้ตรวจสอบตอนบันทึก SchedulingRule และใช้ populate ตัวเลือกบน UI
 *
 * NO_DOUBLE_BOOKING ไม่อยู่ใน list นี้เพราะเป็น Hard Constraint ที่บังคับเสมอในระดับ DB
 * (unique constraint บน ScheduleAssignment.userId+date) ไม่ต้องสร้างแถว SchedulingRule
 *
 * APPROVED_LEAVE_BLOCK พึ่งพา LeaveRequest ซึ่งอยู่ใน MVP 3 (Sprint 9) — ใส่ไว้ล่วงหน้า
 * เพื่อให้ workshop Sprint 0 บันทึกไว้ได้ แต่ Conflict Check ของ Sprint 3 จะยังข้ามการ
 * ประเมินกฎนี้จนกว่า LeaveRequest module จะพร้อม
 */
export const HARD_RULE_KEYS = [
  'MIN_STAFF_PER_SHIFT', // parameters: { shiftCode: string; min: number }
  'MAX_CONSECUTIVE_NIGHT_SHIFTS', // parameters: { shiftCode: string; maxConsecutiveDays: number }
  'MIN_REST_HOURS', // parameters: {} — ห้าม Quick Return ระหว่างเวรข้ามเที่ยงคืนกับเวรเช้าวันถัดไป
  'APPROVED_LEAVE_BLOCK', // parameters: {} — รอ MVP 3 Sprint 9 (LeaveRequest)
] as const;

export const SOFT_RULE_KEYS = [
  'NIGHT_SHIFT_FAIRNESS', // ความเป็นธรรมของเวรดึก — ใช้จริงใน MVP 2 Sprint 6
  'HOLIDAY_SHIFT_FAIRNESS',
  'SHIFT_PATTERN_CONTINUITY',
  'PERSONAL_PREFERENCE',
] as const;

export const ALL_RULE_KEYS = [...HARD_RULE_KEYS, ...SOFT_RULE_KEYS] as const;
export type RuleKey = (typeof ALL_RULE_KEYS)[number];
