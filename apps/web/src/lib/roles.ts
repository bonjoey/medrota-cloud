import type { Role } from './api-client';

/** ชื่อบทบาทภาษาไทยสำหรับแสดงผล (FR-A02) */
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'ผู้ดูแลระบบสูงสุด',
  WARD_ADMIN: 'ผู้ดูแลระบบโรงพยาบาล',
  HEAD_NURSE: 'หัวหน้าพยาบาล',
  NURSE: 'พยาบาล',
};

/**
 * ตารางสิทธิ์ต่อไปนี้สะท้อน @Roles() guard ฝั่ง NestJS จริงทุกจุด (ดู schedules/users/...
 * .controller.ts) — ใช้ซ้อนกับ backend guard เพื่อซ่อนเมนู/ปุ่มที่กดแล้วจะ 403 เท่านั้น
 * ความปลอดภัยจริงอยู่ที่ RolesGuard ฝั่ง API เสมอ
 */
export function canManageHospitalSettings(role: Role) {
  return role === 'SUPER_ADMIN';
}

export function canManageOrgStructure(role: Role) {
  // Wards, Departments, ShiftTypes, SchedulingRules
  return role === 'SUPER_ADMIN' || role === 'WARD_ADMIN';
}

export function canViewUsers(role: Role) {
  return role === 'SUPER_ADMIN' || role === 'WARD_ADMIN' || role === 'HEAD_NURSE';
}

export function canManageUsers(role: Role) {
  return role === 'SUPER_ADMIN' || role === 'WARD_ADMIN';
}

export function canEditSchedule(role: Role) {
  // สร้าง/แก้ไข assignment/ส่งตรวจ
  return role === 'SUPER_ADMIN' || role === 'WARD_ADMIN' || role === 'HEAD_NURSE';
}

export function canApproveSchedule(role: Role) {
  // approve/publish/send-back
  return role === 'SUPER_ADMIN' || role === 'WARD_ADMIN';
}

export function canExportSchedule(role: Role) {
  return role === 'SUPER_ADMIN' || role === 'WARD_ADMIN' || role === 'HEAD_NURSE';
}
