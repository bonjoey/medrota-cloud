import { IsString } from 'class-validator';

/** FR-A04: จัดการข้อมูลแผนก */
export class CreateDepartmentDto {
  @IsString()
  name!: string;
}
