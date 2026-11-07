import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // API Spec หัวข้อ 8.3: POST /api/v1/auth/login
  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto.employeeCodeOrEmail, dto.password, req.ip);
  }

  // NFR-02: Refresh Token Rotation — ขอ access token ใหม่ด้วย refresh token
  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refreshToken, req.ip);
  }

  // NFR-02: เพิกถอน refresh token ของอุปกรณ์นี้
  @Public()
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refreshToken);
    return { success: true };
  }

  // API Spec หัวข้อ 8.3: POST /api/v1/auth/oauth/{provider}
  // TODO Sprint 11 (INT-03/04/05): เชื่อม Passport Google/Microsoft/Facebook strategy จริง
  @Public()
  @Post('oauth/:provider')
  async oauthLogin() {
    throw new Error('ยังไม่ Implement — กำหนดไว้ใน MVP 3 Sprint 11 ตาม MVP_ExecutionPlan');
  }
}
