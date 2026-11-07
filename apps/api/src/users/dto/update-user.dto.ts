import { PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto';

/** FR-A01: แก้ไข/ระงับบัญชีผู้ใช้ */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
