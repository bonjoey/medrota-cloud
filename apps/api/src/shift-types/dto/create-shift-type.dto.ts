import { IsBoolean, IsNumber, IsOptional, IsString, Matches, Min } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** FR-A06: จัดการประเภทเวรและอัตราค่าตอบแทนต่อประเภทเวร */
export class CreateShiftTypeDto {
  @IsString()
  code!: string; // "MORNING" | "AFTERNOON" | "NIGHT" | "SPECIAL" | ...

  @IsString()
  name!: string;

  @Matches(TIME_PATTERN, { message: 'startTime ต้องอยู่ในรูปแบบ HH:MM' })
  startTime!: string;

  @Matches(TIME_PATTERN, { message: 'endTime ต้องอยู่ในรูปแบบ HH:MM' })
  endTime!: string;

  @IsOptional()
  @IsBoolean()
  crossesMidnight?: boolean;

  @IsNumber()
  @Min(0)
  compensationRate!: number;
}
