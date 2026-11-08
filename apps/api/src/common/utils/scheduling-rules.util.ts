import { ForbiddenException } from '@nestjs/common';

interface WardScopedActor {
  role: string;
  wardId?: string | null;
}

/** HEAD_NURSE เข้าถึงได้เฉพาะ Ward ของตนเอง (SUPER_ADMIN/WARD_ADMIN ไม่จำกัด) */
export function assertWardScope(wardId: string, actor: WardScopedActor): void {
  if (actor.role === 'HEAD_NURSE' && wardId !== actor.wardId) {
    throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงตารางเวรของ Ward อื่น');
  }
}

interface WardScopedRule {
  wardId: string | null;
  ruleKey: string;
  parameters: unknown;
}

/**
 * CON-03: กฎระดับ Ward override กฎระดับโรงพยาบาลที่ ruleKey+shiftCode เดียวกัน
 * ใช้ร่วมกันทั้ง FR-A10 (Conflict Check, schedules.service.ts) และ FR-AI01
 * (Auto-suggest, ai-job.service.ts) — ต้องเป็นตรรกะเดียวกันเสมอตาม ADR-0002
 */
export function preferWardSpecificRules<T extends WardScopedRule>(rules: T[]): T[] {
  const keyOf = (r: T) => {
    const shiftCode =
      typeof r.parameters === 'object' && r.parameters !== null && 'shiftCode' in r.parameters
        ? (r.parameters as Record<string, unknown>).shiftCode
        : undefined;
    return `${r.ruleKey}::${shiftCode ?? ''}`;
  };

  const wardSpecificKeys = new Set(rules.filter((r) => r.wardId !== null).map(keyOf));
  return rules.filter((r) => r.wardId !== null || !wardSpecificKeys.has(keyOf(r)));
}
