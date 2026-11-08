import { IsString, MinLength } from 'class-validator';

/** FR-A13: หัวหน้าตึก/ผู้ดูแลระบบปฏิเสธคำขอลา — ต้องระบุเหตุผลเสมอ */
export class RejectLeaveRequestDto {
  @IsString()
  @MinLength(1)
  rejectionReason!: string;
}
