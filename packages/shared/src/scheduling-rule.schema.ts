import { z } from 'zod';

/**
 * FR-A07: รูปแบบกฎระเบียบเวร — ต้องตรงกับ:
 *   - Prisma model SchedulingRule (apps/api/prisma/schema.prisma)
 *   - Pydantic model SchedulingRule (services/ai/app/schemas.py)
 * ตาม ADR-0002 (สัญญาเดียว 3 ภาษา: Prisma/TS/Python)
 */
export const RuleKeySchema = z.enum([
  'MAX_CONSECUTIVE_NIGHT_SHIFTS',
  'MIN_REST_HOURS',
  'MIN_STAFF_PER_SHIFT',
  'NURSE_TO_PATIENT_RATIO',
  'QUICK_RETURN_HOURS',
  'FAIRNESS_NIGHT_DISTRIBUTION',
  'PERSONAL_PREFERENCE',
  'ROTATION_CONTINUITY',
  'OT_COST_CONTROL',
  'FATIGUE_SCORE_PENALTY',
]);

export const SchedulingRuleSchema = z.object({
  ruleKey: RuleKeySchema,
  ruleType: z.enum(['HARD', 'SOFT']),
  parameters: z.record(z.any()),
  weight: z.number().min(0).max(1).optional(),
});

export type SchedulingRule = z.infer<typeof SchedulingRuleSchema>;
