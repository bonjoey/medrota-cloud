import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString } from 'class-validator';
import { RuleType } from '@prisma/client';
import { ALL_RULE_KEYS } from '../../common/constants/rule-keys';

/**
 * FR-A07: บันทึกกฎระเบียบเวร — แยก Hard/Soft Constraint ตั้งแต่ชั้นข้อมูล
 * ruleKey ต้องอยู่ใน Catalog ที่ Python Solver (services/ai) รองรับจริงเท่านั้น (ADR-0002)
 */
export class CreateSchedulingRuleDto {
  @IsOptional()
  @IsString()
  wardId?: string; // null = กฎระดับโรงพยาบาล (FR-A05), ไม่ null = เฉพาะ Ward (CON-03)

  @IsIn(['HARD', 'SOFT'])
  ruleType!: RuleType;

  @IsIn(ALL_RULE_KEYS)
  ruleKey!: string;

  @IsObject()
  parameters!: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  weight?: number; // บังคับเมื่อ ruleType = SOFT (ตรวจใน Service)

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
