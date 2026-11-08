import { IsDateString, IsOptional, IsString } from 'class-validator';

/**
 * FR-AI01 ขั้นที่ 5 (MVP 2 Sprint 8): ขอให้ AI จัดเวรใหม่ "เฉพาะบางช่วงวัน" ของตารางเวรที่
 * มีอยู่แล้ว (เช่น หลังอนุมัติวันลาฉุกเฉิน หรือมีการเปลี่ยนแปลงกะทันหัน) โดยวันนอกช่วงนี้
 * ถูกตรึงไว้ตามเดิมทั้งหมด (ไม่กระทบคนอื่นที่ไม่เกี่ยวข้อง)
 */
export class CreateIncrementalResolveDto {
  @IsDateString()
  startDate!: string; // "YYYY-MM-DD"

  @IsDateString()
  endDate!: string; // "YYYY-MM-DD"

  @IsOptional()
  @IsString()
  reason?: string;
}
