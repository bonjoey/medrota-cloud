/** ตรงกับ enum ใน apps/api/prisma/schema.prisma เสมอ — ห้ามให้ค่าเพี้ยนกัน */

export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  WARD_ADMIN = 'WARD_ADMIN',
  HEAD_NURSE = 'HEAD_NURSE',
  NURSE = 'NURSE',
}

export enum PositionLevel {
  RN = 'RN',
  PN = 'PN',
  NA = 'NA',
}

export enum WardType {
  ICU = 'ICU',
  GENERAL = 'GENERAL',
  ER = 'ER',
  OTHER = 'OTHER',
}

export enum RuleType {
  HARD = 'HARD',
  SOFT = 'SOFT',
}

export enum ScheduleStatus {
  DRAFT = 'DRAFT',
  REVIEW = 'REVIEW',
  APPROVED = 'APPROVED',
  PUBLISHED = 'PUBLISHED',
}
