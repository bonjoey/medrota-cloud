import { IsEnum, IsOptional, IsString } from 'class-validator';
import { WardType } from '@prisma/client';

/** FR-A04: จัดการข้อมูล Ward/แผนก/อาคาร/ประเภทหอผู้ป่วย */
export class CreateWardDto {
  @IsString()
  name!: string;

  @IsEnum(WardType)
  wardType!: WardType;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  building?: string;
}
