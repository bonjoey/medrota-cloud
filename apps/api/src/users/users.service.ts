import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthService } from '../auth/auth.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
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

  async findAll(actor: ActorContext) {
    const users = await this.prisma.user.findMany({
      where: { hospitalId: actor.hospitalId },
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
    await this.findOne(id, actor);
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

  private sanitize(user: { passwordHash?: string | null; [key: string]: unknown }) {
    const { passwordHash, twoFactorSecret, ...rest } = user as Record<string, unknown>;
    return rest;
  }
}
