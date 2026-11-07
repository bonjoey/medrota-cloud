import { IsString, MinLength } from 'class-validator';

/** NFR-02: ผู้ใช้เปลี่ยนรหัสผ่านของตนเอง (ต้องยืนยันรหัสผ่านเดิมก่อน) */
export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}
