import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** ใช้ร่วมกันสำหรับ query param month/year ของทุก endpoint ใน Nurse Portal */
export class SchedulePeriodQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year!: number;
}
