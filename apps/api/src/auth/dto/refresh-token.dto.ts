import { IsString } from 'class-validator';

/** NFR-02: ใช้คู่กับ POST /auth/refresh และ POST /auth/logout */
export class RefreshTokenDto {
  @IsString()
  refreshToken!: string;
}
