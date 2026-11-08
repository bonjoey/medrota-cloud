import { IsString, MinLength } from 'class-validator';

/** FR-U03/BP-02: พยาบาลเสนอแลกเวรของตนเองกับเวรที่มอบหมายให้คนอื่นแล้ว (ไม่จำเป็นต้อง
 * เป็นวันเดียวกัน — แลกได้ข้ามวัน ตราบใดที่อยู่ในตารางเวรเดียวกัน) */
export class CreateShiftSwapDto {
  @IsString()
  @MinLength(1)
  requesterAssignmentId!: string;

  @IsString()
  @MinLength(1)
  counterpartyAssignmentId!: string;
}
