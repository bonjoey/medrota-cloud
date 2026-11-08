import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AiServiceClient, ConflictCheckResult } from '../ai-service/ai-service.client';
import { CreateShiftSwapDto } from './dto/create-shift-swap.dto';
import { CounterpartyDecisionDto, AdminDecisionDto } from './dto/decide-shift-swap.dto';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { assertWardScope, preferWardSpecificRules } from '../common/utils/scheduling-rules.util';
import { fetchApprovedLeavesPayload } from '../common/utils/approved-leaves.util';

/**
 * FR-U03, FR-A12, BP-02 (MVP 3 Sprint 9): แลกเวรระหว่างบุคลากร 2 คน
 *
 * Workflow: PENDING_COUNTERPARTY (รออีกฝ่ายตอบรับ) → PENDING_ADMIN_APPROVAL (รอหัวหน้า
 * ตึกอนุมัติ) → APPROVED (สลับเวรจริงในฐานข้อมูล) | REJECTED | CANCELLED
 *
 * หมายเหตุการตีความ: requesterAssignmentId/counterpartyAssignmentId ใน schema เป็น
 * String เปล่า (ไม่ผูก FK) — ที่นี่บังคับเพิ่มว่าทั้งสองช่องต้องอยู่ในตารางเวร (Schedule)
 * เดียวกันเท่านั้น (แลกข้ามเดือน/Ward ยังไม่รองรับ เพราะ PRD ไม่ได้ระบุ use case นี้ไว้)
 *
 * การสลับจริงใช้วิธี "ลบแล้วสร้างใหม่" ทั้งคู่ในทรานแซกชันเดียว แทนการ update ตรง ๆ
 * เพราะ @@unique([userId, date]) บน ScheduleAssignment จะ fail ชั่วขณะถ้าแลกเวรวันเดียวกัน
 * (เช่น สลับประเภทเวรวันเดียวกัน) — ลบทั้งคู่ก่อนค่อยสร้างใหม่จึงไม่ชนกันเองไม่ว่าวันจะ
 * ตรงกันหรือไม่
 */
@Injectable()
export class ShiftSwapsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly aiServiceClient: AiServiceClient,
  ) {}

  async create(dto: CreateShiftSwapDto, actor: CurrentUserPayload) {
    const [requesterAssignment, counterpartyAssignment] = await Promise.all([
      this.prisma.scheduleAssignment.findFirst({
        where: { id: dto.requesterAssignmentId, schedule: { hospitalId: actor.hospitalId } },
        include: { schedule: true, shiftType: true, user: true },
      }),
      this.prisma.scheduleAssignment.findFirst({
        where: { id: dto.counterpartyAssignmentId, schedule: { hospitalId: actor.hospitalId } },
        include: { schedule: true, shiftType: true, user: true },
      }),
    ]);

    if (!requesterAssignment) throw new NotFoundException('ไม่พบเวรของตนเองที่ระบุ');
    if (!counterpartyAssignment) throw new NotFoundException('ไม่พบเวรของอีกฝ่ายที่ระบุ');

    if (requesterAssignment.userId !== actor.userId) {
      throw new ForbiddenException('เสนอแลกเวรได้เฉพาะเวรของตนเองเท่านั้น');
    }
    if (counterpartyAssignment.userId === actor.userId) {
      throw new BadRequestException('ไม่สามารถแลกเวรกับตนเองได้');
    }
    if (requesterAssignment.scheduleId !== counterpartyAssignment.scheduleId) {
      throw new BadRequestException('แลกเวรได้เฉพาะภายในตารางเวรเดือนเดียวกันเท่านั้น');
    }
    // FR-U03: "ค้นหาเพื่อนร่วมงานที่ตรงคุณสมบัติ" — ตีความคุณสมบัติเป็นระดับตำแหน่ง (RN/PN/NA)
    // เพราะเป็นมิติเดียวที่ schema เก็บไว้ (ความเชี่ยวชาญเฉพาะทาง/ใบอนุญาตไม่ได้โมเดลไว้ในนี้)
    // — ห้ามแลกข้ามระดับ เพราะจะทำให้โครงสร้างกำลังคนต่อเวรผิดจากแผนที่ AI/Admin ตั้งใจไว้
    if (requesterAssignment.user.positionLevel !== counterpartyAssignment.user.positionLevel) {
      throw new BadRequestException(
        `แลกเวรได้เฉพาะระหว่างบุคลากรระดับตำแหน่งเดียวกัน (${requesterAssignment.user.positionLevel} ↔ ${counterpartyAssignment.user.positionLevel})`,
      );
    }

    const constraintCheckResult = await this.previewSwapConflicts(
      requesterAssignment.scheduleId,
      requesterAssignment.id,
      counterpartyAssignment.id,
      actor,
    );

    const swap = await this.prisma.shiftSwapRequest.create({
      data: {
        requesterId: actor.userId,
        counterpartyId: counterpartyAssignment.userId,
        requesterAssignmentId: requesterAssignment.id,
        counterpartyAssignmentId: counterpartyAssignment.id,
        constraintCheckResult: constraintCheckResult as object,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: counterpartyAssignment.userId,
        channel: 'IN_APP',
        category: 'SWAP_REQUEST',
        title: 'มีคนขอแลกเวรกับคุณ',
        body: `${requesterAssignment.user.fullName} เสนอแลกเวรวันที่ ${requesterAssignment.date
          .toISOString()
          .slice(0, 10)} (${requesterAssignment.shiftType.code}) กับเวรของคุณวันที่ ${counterpartyAssignment.date
          .toISOString()
          .slice(0, 10)} (${counterpartyAssignment.shiftType.code})`,
        relatedEntityType: 'ShiftSwapRequest',
        relatedEntityId: swap.id,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CREATE',
      entityType: 'ShiftSwapRequest',
      entityId: swap.id,
      afterJson: swap,
    });

    return swap;
  }

  /** จำลองผลลัพธ์ถ้าสลับ userId ของสองช่องนี้แล้วส่งให้ services/ai ตรวจ Hard Constraint
   * (ADR-0002 — ใช้ checkConflicts เดียวกับ FR-A10 ไม่ re-implement ตรรกะกฎเอง) */
  private async previewSwapConflicts(
    scheduleId: string,
    requesterAssignmentId: string,
    counterpartyAssignmentId: string,
    actor: CurrentUserPayload,
  ): Promise<ConflictCheckResult> {
    const schedule = await this.prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId } });

    const monthStart = new Date(schedule.year, schedule.month - 1, 1);
    const monthEnd = new Date(schedule.year, schedule.month, 0);

    const [assignments, rules, shiftTypes, approvedLeaves] = await Promise.all([
      this.prisma.scheduleAssignment.findMany({ where: { scheduleId }, include: { shiftType: true } }),
      this.prisma.schedulingRule.findMany({
        where: {
          hospitalId: actor.hospitalId,
          ruleType: 'HARD',
          isActive: true,
          OR: [{ wardId: schedule.wardId }, { wardId: null }],
        },
      }),
      this.prisma.shiftType.findMany({ where: { hospitalId: actor.hospitalId } }),
      fetchApprovedLeavesPayload(this.prisma, schedule.wardId, monthStart, monthEnd),
    ]);

    const userIdOverride = new Map<string, string>();
    const requester = assignments.find((a) => a.id === requesterAssignmentId);
    const counterparty = assignments.find((a) => a.id === counterpartyAssignmentId);
    if (requester && counterparty) {
      userIdOverride.set(requesterAssignmentId, counterparty.userId);
      userIdOverride.set(counterpartyAssignmentId, requester.userId);
    }

    const dedupedRules = preferWardSpecificRules(rules);

    return this.aiServiceClient.checkConflicts({
      hospital_id: actor.hospitalId,
      ward_id: schedule.wardId,
      month: schedule.month,
      year: schedule.year,
      assignments: assignments.map((a) => ({
        assignment_id: a.id,
        user_id: userIdOverride.get(a.id) ?? a.userId,
        date: a.date.toISOString().slice(0, 10),
        shift_type_code: a.shiftType.code,
      })),
      shift_types: shiftTypes.map((s) => ({
        code: s.code,
        startTime: s.startTime,
        endTime: s.endTime,
        crossesMidnight: s.crossesMidnight,
        compensationRate: Number(s.compensationRate),
      })),
      rules: dedupedRules.map((r) => ({
        rule_key: r.ruleKey,
        rule_type: r.ruleType,
        parameters: r.parameters as unknown as Record<string, unknown>,
        weight: r.weight ?? undefined,
      })),
      approved_leaves: approvedLeaves,
    });
  }

  private async getSwapOrThrow(id: string, actor: CurrentUserPayload) {
    const swap = await this.prisma.shiftSwapRequest.findFirst({
      where: { id, requester: { hospitalId: actor.hospitalId } },
      include: {
        requester: { select: { id: true, fullName: true, employeeCode: true, primaryWardId: true } },
        counterparty: { select: { id: true, fullName: true, employeeCode: true, primaryWardId: true } },
      },
    });
    if (!swap) throw new NotFoundException('ไม่พบคำขอแลกเวร');

    if (actor.role === 'NURSE' && swap.requesterId !== actor.userId && swap.counterpartyId !== actor.userId) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงคำขอแลกเวรนี้');
    }
    if (
      actor.role === 'HEAD_NURSE' &&
      swap.requester.primaryWardId !== actor.wardId &&
      swap.counterparty.primaryWardId !== actor.wardId
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงคำขอแลกเวรของ Ward อื่น');
    }
    return swap;
  }

  async findAll(actor: CurrentUserPayload, query: { status?: string }) {
    const where: Record<string, unknown> = { requester: { hospitalId: actor.hospitalId } };
    if (query.status) where.status = query.status;

    if (actor.role === 'NURSE') {
      where.OR = [{ requesterId: actor.userId }, { counterpartyId: actor.userId }];
    } else if (actor.role === 'HEAD_NURSE') {
      where.OR = [{ requester: { primaryWardId: actor.wardId } }, { counterparty: { primaryWardId: actor.wardId } }];
    }

    return this.prisma.shiftSwapRequest.findMany({
      where,
      include: {
        requester: { select: { id: true, fullName: true, employeeCode: true } },
        counterparty: { select: { id: true, fullName: true, employeeCode: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, actor: CurrentUserPayload) {
    return this.getSwapOrThrow(id, actor);
  }

  async cancel(id: string, actor: CurrentUserPayload) {
    const swap = await this.getSwapOrThrow(id, actor);
    if (swap.requesterId !== actor.userId) {
      throw new ForbiddenException('ยกเลิกได้เฉพาะผู้เสนอแลกเวรเท่านั้น');
    }
    if (swap.status !== 'PENDING_COUNTERPARTY' && swap.status !== 'PENDING_ADMIN_APPROVAL') {
      throw new ConflictException('ยกเลิกได้เฉพาะคำขอที่ยังไม่ตัดสินใจขั้นสุดท้าย');
    }
    const updated = await this.prisma.shiftSwapRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CANCEL',
      entityType: 'ShiftSwapRequest',
      entityId: id,
    });
    return updated;
  }

  async counterpartyDecision(id: string, dto: CounterpartyDecisionDto, actor: CurrentUserPayload) {
    const swap = await this.getSwapOrThrow(id, actor);
    if (swap.counterpartyId !== actor.userId) {
      throw new ForbiddenException('ตอบรับ/ปฏิเสธได้เฉพาะผู้ถูกขอแลกเวรเท่านั้น');
    }
    if (swap.status !== 'PENDING_COUNTERPARTY') {
      throw new ConflictException('คำขอนี้ไม่อยู่ในสถานะรอการตอบรับ');
    }

    if (!dto.approve) {
      const updated = await this.prisma.shiftSwapRequest.update({
        where: { id },
        data: { status: 'REJECTED', rejectionReason: dto.reason, decidedById: actor.userId, decidedAt: new Date() },
      });
      await this.notifyDecision(swap.requesterId, id, false, 'อีกฝ่ายปฏิเสธการแลกเวร');
      await this.auditLog.record({
        hospitalId: actor.hospitalId,
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'REJECT',
        entityType: 'ShiftSwapRequest',
        entityId: id,
      });
      return updated;
    }

    const updated = await this.prisma.shiftSwapRequest.update({
      where: { id },
      data: { status: 'PENDING_ADMIN_APPROVAL' },
    });

    const requesterAssignment = await this.prisma.scheduleAssignment.findUniqueOrThrow({
      where: { id: swap.requesterAssignmentId },
      include: { schedule: true },
    });
    await this.notifyAdmins(requesterAssignment.schedule.wardId, actor.hospitalId, id);

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'ACCEPT',
      entityType: 'ShiftSwapRequest',
      entityId: id,
    });
    return updated;
  }

  async adminDecision(id: string, dto: AdminDecisionDto, actor: CurrentUserPayload) {
    if (actor.role === 'NURSE') throw new ForbiddenException('ไม่มีสิทธิ์อนุมัติคำขอแลกเวร');
    const swap = await this.getSwapOrThrow(id, actor);
    if (swap.status !== 'PENDING_ADMIN_APPROVAL') {
      throw new ConflictException('อนุมัติได้เฉพาะคำขอที่อีกฝ่ายตอบรับแล้วและรอ Admin อนุมัติ');
    }

    if (!dto.approve) {
      const updated = await this.prisma.shiftSwapRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectionReason: dto.rejectionReason,
          decidedById: actor.userId,
          decidedAt: new Date(),
        },
      });
      await Promise.all([
        this.notifyDecision(swap.requesterId, id, false, dto.rejectionReason ?? 'Admin ปฏิเสธการแลกเวร'),
        this.notifyDecision(swap.counterpartyId, id, false, dto.rejectionReason ?? 'Admin ปฏิเสธการแลกเวร'),
      ]);
      await this.auditLog.record({
        hospitalId: actor.hospitalId,
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'REJECT',
        entityType: 'ShiftSwapRequest',
        entityId: id,
      });
      return updated;
    }

    const [requesterAssignment, counterpartyAssignment] = await Promise.all([
      this.prisma.scheduleAssignment.findUniqueOrThrow({
        where: { id: swap.requesterAssignmentId },
        include: { schedule: true },
      }),
      this.prisma.scheduleAssignment.findUniqueOrThrow({ where: { id: swap.counterpartyAssignmentId } }),
    ]);
    assertWardScope(requesterAssignment.schedule.wardId, actor);

    const freshCheck = await this.previewSwapConflicts(
      requesterAssignment.scheduleId,
      requesterAssignment.id,
      counterpartyAssignment.id,
      actor,
    );
    if (!freshCheck.is_valid) {
      throw new ConflictException({
        message: `ไม่สามารถอนุมัติแลกเวรได้ — จะทำให้ตารางเวรขัดกับกฎระเบียบ ${freshCheck.violations.length} รายการ`,
        violations: freshCheck.violations,
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.scheduleAssignment.delete({ where: { id: requesterAssignment.id } });
      await tx.scheduleAssignment.delete({ where: { id: counterpartyAssignment.id } });
      await tx.scheduleAssignment.create({
        data: {
          scheduleId: requesterAssignment.scheduleId,
          userId: counterpartyAssignment.userId,
          shiftTypeId: requesterAssignment.shiftTypeId,
          date: requesterAssignment.date,
          isManualOverride: true,
        },
      });
      await tx.scheduleAssignment.create({
        data: {
          scheduleId: counterpartyAssignment.scheduleId,
          userId: requesterAssignment.userId,
          shiftTypeId: counterpartyAssignment.shiftTypeId,
          date: counterpartyAssignment.date,
          isManualOverride: true,
        },
      });
      await tx.scheduleChangeLog.create({
        data: {
          scheduleId: requesterAssignment.scheduleId,
          changedById: actor.userId,
          changeType: 'SHIFT_SWAP',
          beforeJson: { requesterAssignment, counterpartyAssignment } as object,
          reason: `แลกเวรอนุมัติแล้ว (ShiftSwapRequest ${id})`,
        },
      });
      return tx.shiftSwapRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedById: actor.userId,
          decidedAt: new Date(),
          constraintCheckResult: freshCheck as object,
        },
      });
    });

    await Promise.all([
      this.notifyDecision(swap.requesterId, id, true, 'แลกเวรสำเร็จแล้ว'),
      this.notifyDecision(swap.counterpartyId, id, true, 'แลกเวรสำเร็จแล้ว'),
    ]);

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'APPROVE',
      entityType: 'ShiftSwapRequest',
      entityId: id,
    });

    return updated;
  }

  private async notifyDecision(userId: string, swapId: string, approved: boolean, body: string) {
    await this.prisma.notification.create({
      data: {
        userId,
        channel: 'IN_APP',
        category: 'SWAP_DECISION',
        title: approved ? 'คำขอแลกเวรได้รับการอนุมัติ' : 'คำขอแลกเวรไม่สำเร็จ',
        body,
        relatedEntityType: 'ShiftSwapRequest',
        relatedEntityId: swapId,
      },
    });
  }

  private async notifyAdmins(wardId: string, hospitalId: string, swapId: string) {
    const admins = await this.prisma.user.findMany({
      where: {
        hospitalId,
        status: 'ACTIVE',
        OR: [{ role: 'HEAD_NURSE', primaryWardId: wardId }, { role: { in: ['WARD_ADMIN', 'SUPER_ADMIN'] } }],
      },
    });
    await this.prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        channel: 'IN_APP' as const,
        category: 'SWAP_REQUEST',
        title: 'คำขอแลกเวรรอการอนุมัติ',
        body: 'ทั้งสองฝ่ายตอบรับการแลกเวรแล้ว รอการอนุมัติขั้นสุดท้ายจากท่าน',
        relatedEntityType: 'ShiftSwapRequest',
        relatedEntityId: swapId,
      })),
    });
  }
}
