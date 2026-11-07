import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * FR-A01/A02, NFR-02: Login, Refresh Token Rotation
 *
 * หมายเหตุ: ฟังก์ชัน hashPassword/verifyPassword ด้านล่างเป็น placeholder ด้วย
 * Node crypto (scrypt) — เมื่อติดตั้ง dependency แล้วให้พิจารณาเปลี่ยนเป็น argon2
 * ซึ่งเป็นมาตรฐานที่แข็งแรงกว่าสำหรับ production (ยังไม่ fix เป็น argon2 ใน scaffold
 * นี้เพื่อไม่ต้องพึ่ง native binding ตอน bootstrap ครั้งแรก)
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  async validateUser(employeeCodeOrEmail: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ employeeCode: employeeCodeOrEmail }, { email: employeeCodeOrEmail }],
      },
    });

    if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    const isValid = this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }

    return user;
  }

  async login(employeeCodeOrEmail: string, password: string, ipAddress?: string) {
    const user = await this.validateUser(employeeCodeOrEmail, password);

    const payload = {
      sub: user.id,
      hospitalId: user.hospitalId,
      role: user.role,
      wardId: user.primaryWardId,
    };

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
    });

    await this.auditLog.record({
      hospitalId: user.hospitalId,
      actorId: user.id,
      actorRole: user.role,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
    });

    return { accessToken, refreshToken };
  }

  hashPassword(plain: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(plain: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    const candidateHash = crypto.scryptSync(plain, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidateHash, 'hex'));
  }
}
