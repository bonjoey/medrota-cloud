import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
  wardId?: string | null;
}

/**
 * FR-A01: จัดการผู้ใช้งาน (เพิ่ม/แก้ไข/ระงับบัญชี, กำหนด Role/แผนก/ระดับตำแหน่ง/สิทธิ์)
 *
 * ทุก Method filter ด้วย hospitalId ของผู้เรียกเสมอ (ADR-0003 — ป้องกัน Data Leak ข้าม Tenant)
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly authService: AuthService,
  ) {}

  async create(dto: CreateUserDto, actor: ActorContext) {
    const existing = await this.prisma.user.findFirst({
      where: { employeeCode: dto.employeeCode },
    });
    if (existing) {
      throw new ConflictException('รหัสประจำตัวนี้มีอยู่ในระบบแล้ว');
    }

    const user = await this.prisma.user.create({
      data: {
        hospitalId: actor.hospitalId,
        employeeCode: dto.employeeCode,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        passwordHash: this.authService.hashPassword(dto.password),
        role: dto.role,
        positionLevel: dto.positionLevel,
        primaryWardId: dto.primaryWardId,
        mustChangePassword: true, // Admin ตั้งรหัสผ่านชั่วคราว — บังคับเปลี่ยนตอนเข้าสู่ระบบครั้งแรก
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      afterJson: { ...user, passwordHash: undefined },
    });

    return this.sanitize(user);
  }

  /**
   * FR-A02 resource-level scoping (ตามหมายเหตุใน RolesGuard): HeadNurse เห็นเฉพาะ
   * บุคลากรใน Ward ของตนเท่านั้น ส่วน SuperAdmin/WardAdmin เห็นทั้งโรงพยาบาล
   */
  async findAll(actor: ActorContext) {
    const users = await this.prisma.user.findMany({
      where: {
        hospitalId: actor.hospitalId,
        ...(actor.role === 'HEAD_NURSE' ? { primaryWardId: actor.wardId ?? undefined } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return users.map((u) => this.sanitize(u));
  }

  async findOne(id: string, actor: ActorContext) {
    const user = await this.prisma.user.findFirst({
      where: { id, hospitalId: actor.hospitalId },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');
    return this.sanitize(user);
  }

  async update(id: string, dto: UpdateUserDto, actor: ActorContext) {
    const before = await this.findOne(id, actor);
    this.assertWardScope((before as { primaryWardId?: string | null }).primaryWardId, actor);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone,
        role: dto.role,
        positionLevel: dto.positionLevel,
        primaryWardId: dto.primaryWardId,
        ...(dto.password ? { passwordHash: this.authService.hashPassword(dto.password) } : {}),
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      beforeJson: before,
      afterJson: this.sanitize(user),
    });

    return this.sanitize(user);
  }

  /** FR-A01: ระงับบัญชี (ไม่ลบจริงเพื่อรักษาความสมบูรณ์ของ Audit Log/ประวัติเวร) */
  async suspend(id: string, actor: ActorContext) {
    const before = await this.findOne(id, actor);
    this.assertWardScope((before as { primaryWardId?: string | null }).primaryWardId, actor);
    const user = await this.prisma.user.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'SUSPEND',
      entityType: 'User',
      entityId: id,
    });

    return this.sanitize(user);
  }

  /** FR-A01: คืนสิทธิ์บัญชีที่ถูกระงับไว้ให้กลับมาใช้งานได้ (reactivate) */
  async reactivate(id: string, actor: ActorContext) {
    const before = await this.findOne(id, actor);
    this.assertWardScope((before as { primaryWardId?: string | null }).primaryWardId, actor);
    const user = await this.prisma.user.update({
      where: { id },
      data: { status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'REACTIVATE',
      entityType: 'User',
      entityId: id,
    });

    return this.sanitize(user);
  }

  /** NFR-02: ผู้ใช้เปลี่ยนรหัสผ่านของตนเอง — ต้องยืนยันรหัสผ่านเดิมก่อนเสมอ */
  async changeOwnPassword(dto: ChangePasswordDto, actor: ActorContext) {
    const user = await this.prisma.user.findUnique({ where: { id: actor.userId } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('ไม่พบบัญชีผู้ใช้');
    }

    const isCurrentValid = this.authService.verifyPassword(dto.currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      throw new BadRequestException('รหัสผ่านเดิมไม่ถูกต้อง');
    }

    await this.prisma.user.update({
      where: { id: actor.userId },
      data: {
        passwordHash: this.authService.hashPassword(dto.newPassword),
        passwordUpdatedAt: new Date(),
        mustChangePassword: false,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CHANGE_PASSWORD',
      entityType: 'User',
      entityId: actor.userId,
    });

    return { success: true };
  }

  /** ป้องกัน HeadNurse แก้ไข/ระงับบัญชีของบุคลากรนอก Ward ตนเอง (FR-A02 resource-level scoping) */
  private assertWardScope(targetWardId: string | null | undefined, actor: ActorContext) {
    if (actor.role === 'HEAD_NURSE' && targetWardId !== actor.wardId) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการบุคลากรนอก Ward ของตน');
    }
  }

  private sanitize(user: { passwordHash?: string | null; [key: string]: unknown }) {
    const { passwordHash, twoFactorSecret, ...rest } = user as Record<string, unknown>;
    return rest;
  }
}
