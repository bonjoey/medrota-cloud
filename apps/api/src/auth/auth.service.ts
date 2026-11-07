import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';

/**
 * FR-A01/A02, NFR-02: Login, Password Policy, Account Lockout, Refresh Token Rotation
 *
 * หมายเหตุ: ฟังก์ชัน hashPassword/verifyPassword ด้านล่างเป็น placeholder ด้วย
 * Node crypto (scrypt) — เมื่อติดตั้ง dependency แล้วให้พิจารณาเปลี่ยนเป็น argon2
 * ซึ่งเป็นมาตรฐานที่แข็งแรงกว่าสำหรับ production (ยังไม่ fix เป็น argon2 ใน scaffold
 * นี้เพื่อไม่ต้องพึ่ง native binding ตอน bootstrap ครั้งแรก)
 *
 * NFR-02 Account Lockout: ล็อกบัญชี 15 นาทีหลังพยายามเข้าสู่ระบบผิดติดต่อกัน 5 ครั้ง
 * NFR-02 Refresh Token Rotation: ทุกครั้งที่ใช้ refresh token เดิมจะถูก revoke ทันที
 * และออก token ใหม่ให้ (เก็บเฉพาะ hash ใน DB) — ถ้ามีคนพยายามเล่น token เก่าที่ revoke
 * ไปแล้วซ้ำ ถือเป็นสัญญาณ token รั่วไหล จะ revoke token ทั้งตระกูล (family) ทันที
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** NFR-02 Password Policy: อย่างน้อย 8 ตัวอักษร มีตัวอักษรและตัวเลขอย่างน้อย 1 ตัวแต่ละประเภท */
  static validatePasswordPolicy(password: string): void {
    if (password.length < 8) {
      throw new BadRequestException('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new BadRequestException('รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลขอย่างน้อยอย่างละ 1 ตัว');
    }
  }

  async validateUser(employeeCodeOrEmail: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ employeeCode: employeeCodeOrEmail }, { email: employeeCodeOrEmail }],
      },
    });

    // ข้อความ error เดียวกันไม่ว่าจะหาผู้ใช้ไม่พบหรือรหัสผ่านผิด เพื่อไม่ให้รู้ว่า username มีจริงหรือไม่
    const genericError = () => new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

    if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
      throw genericError();
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new UnauthorizedException(
        `บัญชีถูกล็อกชั่วคราวเนื่องจากพยายามเข้าสู่ระบบผิดหลายครั้ง กรุณาลองใหม่อีก ${minutesLeft} นาที`,
      );
    }

    const isValid = this.verifyPassword(password, user.passwordHash);
    if (!isValid) {
      const attempts = user.failedLoginAttempts + 1;
      const lockedUntil =
        attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, ...(lockedUntil ? { lockedUntil } : {}) },
      });
      throw genericError();
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    return user;
  }

  async login(employeeCodeOrEmail: string, password: string, ipAddress?: string) {
    const user = await this.validateUser(employeeCodeOrEmail, password);
    const familyId = crypto.randomUUID();
    const tokens = await this.issueTokenPair(user, familyId, ipAddress);

    await this.auditLog.record({
      hospitalId: user.hospitalId,
      actorId: user.id,
      actorRole: user.role,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
    });

    return {
      ...tokens,
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        hospitalId: user.hospitalId,
        wardId: user.primaryWardId,
      },
    };
  }

  /** NFR-02: Refresh Token Rotation — ออก token คู่ใหม่, revoke ตัวเก่า, ตรวจการเล่นซ้ำ (replay) */
  async refresh(rawRefreshToken: string, ipAddress?: string) {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify(rawRefreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token ไม่ถูกต้องหรือหมดอายุ');
    }

    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException('Refresh token ไม่ถูกต้อง');
    }

    if (stored.revokedAt) {
      // Replay ของ token ที่ revoke ไปแล้ว = สัญญาณ token รั่วไหล → revoke ทั้งตระกูลทันที
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('ตรวจพบการใช้ Refresh token ที่ถูกเพิกถอนแล้ว กรุณาเข้าสู่ระบบใหม่');
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token หมดอายุ');
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('บัญชีผู้ใช้ไม่พร้อมใช้งาน');
    }

    const newTokens = await this.issueTokenPair(user, stored.familyId, ipAddress);
    const newHash = this.hashToken(newTokens.refreshToken);

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedByTokenHash: newHash },
    });

    return newTokens;
  }

  /** เพิกถอน refresh token ปัจจุบัน (logout จากอุปกรณ์นี้เท่านั้น) */
  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokenPair(
    user: { id: string; hospitalId: string; role: string; primaryWardId: string | null },
    familyId: string,
    ipAddress?: string,
  ) {
    const payload = {
      sub: user.id,
      hospitalId: user.hospitalId,
      role: user.role,
      wardId: user.primaryWardId,
    };

    const accessExpiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    const refreshExpiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const accessToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessExpiresIn,
    });

    const refreshToken = this.jwt.sign(payload, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshExpiresIn,
    });

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.parseDurationMs(refreshExpiresIn)),
        ipAddress,
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** แปลงค่าเช่น "15m", "7d", "3600s" เป็นมิลลิวินาที (รองรับเฉพาะหน่วย s/m/h/d) */
  private parseDurationMs(value: string): number {
    const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());
    if (!match) return 7 * 24 * 60 * 60 * 1000; // fallback 7 วัน
    const amount = Number(match[1]);
    const unitMs = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2] as 's' | 'm' | 'h' | 'd'];
    return amount * unitMs;
  }

  hashPassword(plain: string): string {
    AuthService.validatePasswordPolicy(plain);
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  /** เปิดเป็น public ให้ UsersService ใช้ตอน self-service เปลี่ยนรหัสผ่าน (ต้องยืนยันรหัสผ่านเดิม) */
  verifyPassword(plain: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    const candidateHash = crypto.scryptSync(plain, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(candidateHash, 'hex'));
  }
}
