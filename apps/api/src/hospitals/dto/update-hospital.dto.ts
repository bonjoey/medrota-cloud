import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/** FR-A05: จัดการข้อมูลโรงพยาบาลและนโยบายการขึ้นเวรระดับองค์กร */
export class UpdateHospitalDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  /** นโยบายระดับองค์กร — ค่า default ก่อน Ward ใดมี SchedulingRule เฉพาะของตนเอง (CON-03) */
  @IsOptional()
  @IsInt()
  @Min(0)
  minHoursPerMonth?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxHoursPerMonth?: number;
}
