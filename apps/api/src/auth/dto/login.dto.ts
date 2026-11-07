import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  employeeCodeOrEmail!: string;

  @IsString()
  @MinLength(8) // NFR-02: Password Policy ขั้นต่ำ 8 ตัวอักษร
  password!: string;
}
