import { IsDateString, IsString } from 'class-validator';

/** FR-A08: กำหนดเวร 1 ช่อง (1 บุคคล × 1 วัน) บน Grid — รองรับ Drag-and-Drop */
export class UpsertAssignmentDto {
  @IsString()
  userId!: string;

  @IsString()
  shiftTypeId!: string;

  @IsDateString()
  date!: string; // "YYYY-MM-DD"
}
