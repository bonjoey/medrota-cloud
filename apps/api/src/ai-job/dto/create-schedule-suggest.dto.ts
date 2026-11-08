import { IsInt, IsString, Max, Min } from 'class-validator';

/** FR-AI01: ขอให้ AI เสนอตารางเวรประจำเดือนสำหรับ Ward หนึ่ง (รันแบบ Asynchronous ผ่าน Queue) */
export class CreateScheduleSuggestDto {
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
