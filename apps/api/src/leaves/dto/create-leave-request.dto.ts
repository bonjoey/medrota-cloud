import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { LeaveType } from '@prisma/client';

/** FR-U04 / BP-03: พยาบาลยื่นคำขอลา */
export class CreateLeaveRequestDto {
  @IsEnum(LeaveType)
  leaveType!: LeaveType;

  @IsDateString()
  startDate!: string; // "YYYY-MM-DD"

  @IsDateString()
  endDate!: string; // "YYYY-MM-DD"

  @IsString()
  @MinLength(1)
  reason!: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;

  /** BP-03 EX-2: เส้นทางเร่งด่วน — ข้าม pre-check วันลาคงเหลือ และกระตุ้น Incremental
   * Re-solve อัตโนมัติทันทีที่อนุมัติ (ไม่ต้องรอ Admin สั่งจัดใหม่เอง) */
  @IsOptional()
  @IsBoolean()
  isEmergency?: boolean;
}
