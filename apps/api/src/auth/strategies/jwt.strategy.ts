import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string; // userId
  hospitalId: string;
  role: string;
  wardId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? 'change-me-in-production',
    });
  }

  async validate(payload: JwtPayload) {
    // ตรวจว่า User ยัง ACTIVE อยู่จริง (ไม่ใช่แค่เชื่อ Token) — ป้องกันบัญชีที่ถูกระงับยังใช้ Token เดิมได้
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('บัญชีผู้ใช้ไม่พร้อมใช้งาน');
    }

    return {
      userId: user.id,
      hospitalId: user.hospitalId,
      role: user.role,
      wardId: user.primaryWardId,
    };
  }
}
