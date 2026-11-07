import { IsInt, IsString, Max, Min } from 'class-validator';

/** FR-A08: สร้างตารางเวรประจำเดือน (เริ่มต้นเป็น DRAFT, Manual source) */
export class CreateScheduleDto {
  @IsString()
  wardId!: string;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @IsInt()
  @Min(2000)
  year!: number;
}
