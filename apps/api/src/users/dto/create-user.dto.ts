import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { PositionLevel, Role } from '@prisma/client';

/** FR-A01: เพิ่มผู้ใช้งาน */
export class CreateUserDto {
  @IsString()
  employeeCode!: string;

  @IsString()
  fullName!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(8) // NFR-02
  password!: string;

  @IsEnum(Role)
  role!: Role;

  @IsEnum(PositionLevel)
  positionLevel!: PositionLevel;

  @IsOptional()
  @IsString()
  primaryWardId?: string;
}
