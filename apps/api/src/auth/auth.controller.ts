import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
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

  // API Spec หัวข้อ 8.3: POST /api/v1/auth/oauth/{provider}
  // TODO Sprint 11 (INT-03/04/05): เชื่อม Passport Google/Microsoft/Facebook strategy จริง
  @Public()
  @Post('oauth/:provider')
  async oauthLogin() {
    throw new Error('ยังไม่ Implement — กำหนดไว้ใน MVP 3 Sprint 11 ตาม MVP_ExecutionPlan');
  }
}
