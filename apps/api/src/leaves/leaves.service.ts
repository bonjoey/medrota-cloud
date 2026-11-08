import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { LeaveType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AiJobService } from '../ai-job/ai-job.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { RejectLeaveRequestDto } from './dto/decide-leave-request.dto';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { preferWardSpecificRules } from '../common/utils/scheduling-rules.util';

/** ฟิลด์สิทธิวันลาคงเหลือบน User ที่ผูกกับ LeaveType แต่ละประเภท (FR-U04) —
 * EMERGENCY/OTHER ไม่มีฟิลด์คู่กันใน schema จึงไม่หักวันลาอัตโนมัติ (ต้องจัดการนอกระบบ) */
const BALANCE_FIELD: Partial<Record<LeaveType, 'annualLeaveBalance' | 'sickLeaveBalance' | 'personalLeaveBalance'>> = {
  VACATION: 'annualLeaveBalance',
  SICK: 'sickLeaveBalance',
  PERSONAL: 'personalLeaveBalance',
};

function diffDaysInclusive(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

/** เดือน/ปีปฏิทินทุกเดือนที่ช่วง [start,end] คาบเกี่ยว (รองรับลาคาบเกี่ยว 2 เดือน) */
function overlappingMonths(start: Date, end: Date): Array<{ month: number; year: number }> {
  const result: Array<{ month: number; year: number }> = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last) {
    result.push({ month: cursor.getMonth() + 1, year: cursor.getFullYear() });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return result;
}

/**
 * FR-U04, FR-A13, BP-03 (MVP 3 Sprint 9): คำขอลา
 *
 * หมายเหตุการตีความ (PRD ไม่ได้ระบุสูตรละเอียด):
 * - impactAssessment เป็นข้อมูล "แนะนำ" ให้หัวหน้าตึกประกอบการตัดสินใจเท่านั้น ไม่ใช่
 *   ตัวบังคับ (Hard Gate) — การบังคับจริงเกิดที่ services/ai ตอน Incremental Re-solve/
 *   Check-conflicts ด้วย APPROVED_LEAVE_BLOCK (ADR-0002 ห้ามมีตรรกะกฎสองชุดที่ขัดกัน
 *   ที่นี่จึงอ่านแค่ threshold ตัวเลขจาก SchedulingRule.parameters.min มาเทียบ ไม่ได้
 *   re-implement Constraint Solver ซ้ำ)
 * - Incremental Re-solve อัตโนมัติ: เกิดเฉพาะตอนอนุมัติคำขอลา "ฉุกเฉิน" (isEmergency)
 *   เท่านั้น (ตามที่บันทึกไว้ใน sprint0-status.md) — คำขอลาปกติ (วางแผนล่วงหน้า) ให้ Admin
 *   สั่ง Incremental Re-solve เองผ่านหน้าตารางเวรตามจังหวะที่ต้องการ
 */
@Injectable()
export class LeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly aiJobService: AiJobService,
  ) {}

  async create(dto: CreateLeaveRequestDto, actor: CurrentUserPayload) {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) {
      throw new BadRequestException('วันสิ้นสุดต้องไม่ก่อนวันเริ่มลา');
    }

    const user = await this.prisma.user.findFirst({ where: { id: actor.userId, hospitalId: actor.hospitalId } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');

    const dayCount = diffDaysInclusive(startDate, endDate);
    const balanceField = BALANCE_FIELD[dto.leaveType];

    if (balanceField && !dto.isEmergency && user[balanceField] < dayCount) {
      throw new BadRequestException(
        `สิทธิวันลาคงเหลือไม่พอ (เหลือ ${user[balanceField]} วัน ขอลา ${dayCount} วัน) — ถ้าจำเป็นเร่งด่วนให้เลือกลาฉุกเฉิน`,
      );
    }

    const impactAssessment = await this.buildImpactAssessment(actor.userId, actor.hospitalId, startDate, endDate);

    const leave = await this.prisma.leaveRequest.create({
      data: {
        userId: actor.userId,
        leaveType: dto.leaveType,
        startDate,
        endDate,
        reason: dto.reason,
        attachmentUrl: dto.attachmentUrl,
        isEmergency: dto.isEmergency ?? false,
        impactAssessment: impactAssessment as object,
      },
    });

    await this.notifyApprovers(user, leave.id, dto.isEmergency ?? false);

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CREATE',
      entityType: 'LeaveRequest',
      entityId: leave.id,
      afterJson: leave,
    });

    return leave;
  }

  /**
   * ประเมินผลกระทบคร่าว ๆ (advisory): หาเวรที่ผู้ขอลามีอยู่แล้วในช่วงวันที่ขอลา (ถ้ามีตาราง
   * เวรของ Ward ตนในเดือนนั้นแล้ว) แล้วเทียบจำนวนคนที่เหลือต่อเวรกับ MIN_STAFF_PER_SHIFT
   */
  private async buildImpactAssessment(userId: string, hospitalId: string, startDate: Date, endDate: Date) {
    const affected = await this.prisma.scheduleAssignment.findMany({
      where: { userId, date: { gte: startDate, lte: endDate } },
      include: { shiftType: true, schedule: true },
    });

    if (affected.length === 0) {
      return { affectedShifts: [], understaffedShifts: [], note: 'ยังไม่มีเวรที่มอบหมายในช่วงที่ขอลา' };
    }

    const wardIds = Array.from(new Set(affected.map((a) => a.schedule.wardId)));
    const rules = await this.prisma.schedulingRule.findMany({
      where: {
        hospitalId,
        ruleType: 'HARD',
        ruleKey: 'MIN_STAFF_PER_SHIFT',
        isActive: true,
        OR: [{ wardId: { in: wardIds } }, { wardId: null }],
      },
    });
    const dedupedRules = preferWardSpecificRules(rules);

    const understaffedShifts: Array<{ date: string; shiftTypeCode: string; currentCount: number; minimumRequired: number }> = [];
    const affectedShifts: Array<{ date: string; shiftTypeCode: string; scheduleId: string }> = [];

    for (const a of affected) {
      affectedShifts.push({ date: a.date.toISOString().slice(0, 10), shiftTypeCode: a.shiftType.code, scheduleId: a.scheduleId });

      const rule = dedupedRules.find(
        (r) => (r.parameters as Record<string, unknown>)?.shiftCode === a.shiftType.code && r.wardId === a.schedule.wardId,
      ) ?? dedupedRules.find((r) => (r.parameters as Record<string, unknown>)?.shiftCode === a.shiftType.code);
      if (!rule) continue;

      const minRequired = Number((rule.parameters as Record<string, unknown>)?.min ?? 0);
      const currentCount = await this.prisma.scheduleAssignment.count({
        where: { scheduleId: a.scheduleId, date: a.date, shiftTypeId: a.shiftTypeId },
      });
      // currentCount รวมตัวผู้ขอลาเองอยู่ด้วย — ถ้าลาแล้วจะเหลือ currentCount - 1
      if (currentCount - 1 < minRequired) {
        understaffedShifts.push({
          date: a.date.toISOString().slice(0, 10),
          shiftTypeCode: a.shiftType.code,
          currentCount: currentCount - 1,
          minimumRequired: minRequired,
        });
      }
    }

    return { affectedShifts, understaffedShifts };
  }

  private async notifyApprovers(requester: { fullName: string; primaryWardId: string | null; hospitalId: string }, leaveId: string, isEmergency: boolean) {
    const approvers = await this.prisma.user.findMany({
      where: {
        hospitalId: requester.hospitalId,
        status: 'ACTIVE',
        OR: [
          { role: 'HEAD_NURSE', primaryWardId: requester.primaryWardId },
          { role: { in: ['WARD_ADMIN', 'SUPER_ADMIN'] } },
        ],
      },
    });

    await this.prisma.notification.createMany({
      data: approvers.map((approver) => ({
        userId: approver.id,
        channel: 'IN_APP' as const,
        category: 'LEAVE_REQUEST',
        title: isEmergency ? 'คำขอลาฉุกเฉิน — ต้องตอบกลับโดยเร็ว' : 'คำขอลาใหม่รออนุมัติ',
        body: `${requester.fullName} ยื่นคำขอลา${isEmergency ? ' (ฉุกเฉิน ตอบภายใน 15 นาทีตามนโยบาย)' : ''}`,
        relatedEntityType: 'LeaveRequest',
        relatedEntityId: leaveId,
      })),
    });
  }

  private async getLeaveOrThrow(id: string, actor: CurrentUserPayload) {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id, user: { hospitalId: actor.hospitalId } },
      include: { user: { select: { id: true, fullName: true, employeeCode: true, primaryWardId: true, hospitalId: true } } },
    });
    if (!leave) throw new NotFoundException('ไม่พบคำขอลา');

    if (actor.role === 'NURSE' && leave.userId !== actor.userId) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงคำขอลาของผู้อื่น');
    }
    if (actor.role === 'HEAD_NURSE' && leave.user.primaryWardId !== actor.wardId) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงคำขอลาของ Ward อื่น');
    }
    return leave;
  }

  async findAll(actor: CurrentUserPayload, query: { status?: string; userId?: string }) {
    const where: Record<string, unknown> = { user: { hospitalId: actor.hospitalId } };
    if (query.status) where.status = query.status;

    if (actor.role === 'NURSE') {
      where.userId = actor.userId;
    } else if (actor.role === 'HEAD_NURSE') {
      where.user = { hospitalId: actor.hospitalId, primaryWardId: actor.wardId };
      if (query.userId) where.userId = query.userId;
    } else if (query.userId) {
      where.userId = query.userId;
    }

    return this.prisma.leaveRequest.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, employeeCode: true, primaryWardId: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, actor: CurrentUserPayload) {
    return this.getLeaveOrThrow(id, actor);
  }

  async cancel(id: string, actor: CurrentUserPayload) {
    const leave = await this.getLeaveOrThrow(id, actor);
    if (leave.userId !== actor.userId) {
      throw new ForbiddenException('ยกเลิกได้เฉพาะคำขอลาของตนเอง');
    }
    if (leave.status !== 'PENDING') {
      throw new ConflictException('ยกเลิกได้เฉพาะคำขอลาที่ยังรอการอนุมัติ');
    }
    const updated = await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CANCEL',
      entityType: 'LeaveRequest',
      entityId: id,
    });
    return updated;
  }

  async approve(id: string, actor: CurrentUserPayload) {
    if (actor.role === 'NURSE') throw new ForbiddenException('ไม่มีสิทธิ์อนุมัติคำขอลา');
    const leave = await this.getLeaveOrThrow(id, actor);
    if (leave.status !== 'PENDING') {
      throw new ConflictException('อนุมัติได้เฉพาะคำขอลาที่ยังรอการอนุมัติ');
    }

    const balanceField = BALANCE_FIELD[leave.leaveType];
    const dayCount = diffDaysInclusive(leave.startDate, leave.endDate);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (balanceField) {
        const current = (await tx.user.findUniqueOrThrow({ where: { id: leave.userId } }))[balanceField];
        await tx.user.update({ where: { id: leave.userId }, data: { [balanceField]: Math.max(0, current - dayCount) } });
      }
      return tx.leaveRequest.update({
        where: { id },
        data: { status: 'APPROVED', decidedById: actor.userId, decidedAt: new Date() },
      });
    });

    let incrementalResolveJobId: string | null = null;
    if (leave.isEmergency && leave.user.primaryWardId) {
      incrementalResolveJobId = await this.triggerIncrementalResolve(leave, actor);
      if (incrementalResolveJobId) {
        await this.prisma.leaveRequest.update({ where: { id }, data: { incrementalResolveJobId } });
      }
    }

    await this.prisma.notification.create({
      data: {
        userId: leave.userId,
        channel: 'IN_APP',
        category: 'LEAVE_DECISION',
        title: 'คำขอลาได้รับการอนุมัติ',
        body: incrementalResolveJobId
          ? 'คำขอลาของคุณได้รับการอนุมัติแล้ว ระบบกำลังจัดเวรทดแทนให้อัตโนมัติ'
          : 'คำขอลาของคุณได้รับการอนุมัติแล้ว',
        relatedEntityType: 'LeaveRequest',
        relatedEntityId: id,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'APPROVE',
      entityType: 'LeaveRequest',
      entityId: id,
      afterJson: { status: 'APPROVED', incrementalResolveJobId },
    });

    return updated;
  }

  /** BP-03 EX-2: ลาฉุกเฉินที่อนุมัติแล้ว → สั่ง Incremental Re-solve ทันทีถ้ามีตารางเวรของ
   * Ward/เดือนนั้นอยู่แล้ว (ข้ามเงียบ ๆ ถ้ายังไม่มีตารางเวร เพราะไม่มีอะไรให้จัดใหม่) */
  private async triggerIncrementalResolve(
    leave: { startDate: Date; endDate: Date; user: { primaryWardId: string | null } },
    actor: CurrentUserPayload,
  ): Promise<string | null> {
    const wardId = leave.user.primaryWardId;
    if (!wardId) return null;

    let lastJobId: string | null = null;
    for (const { month, year } of overlappingMonths(leave.startDate, leave.endDate)) {
      const schedule = await this.prisma.schedule.findUnique({ where: { wardId_month_year: { wardId, month, year } } });
      if (!schedule) continue;

      const monthStart = new Date(year, month - 1, 1);
      const monthEnd = new Date(year, month, 0);
      const windowStart = leave.startDate > monthStart ? leave.startDate : monthStart;
      const windowEnd = leave.endDate < monthEnd ? leave.endDate : monthEnd;

      try {
        const result = await this.aiJobService.enqueueIncrementalResolve(
          schedule.id,
          {
            startDate: windowStart.toISOString().slice(0, 10),
            endDate: windowEnd.toISOString().slice(0, 10),
            reason: 'อนุมัติลาฉุกเฉิน — จัดเวรทดแทนอัตโนมัติ (BP-03 EX-2)',
          },
          { ...actor, wardId: actor.wardId ?? wardId },
        );
        lastJobId = result.aiJobId;
      } catch {
        // ไม่ควรให้การอนุมัติลาล้มเหลวเพราะ AI Service ไม่พร้อมใช้งานชั่วคราว — ปล่อยให้ Admin
        // สั่ง Incremental Re-solve เองทีหลังผ่านหน้าตารางเวรได้เสมอ
      }
    }
    return lastJobId;
  }

  async reject(id: string, dto: RejectLeaveRequestDto, actor: CurrentUserPayload) {
    if (actor.role === 'NURSE') throw new ForbiddenException('ไม่มีสิทธิ์ปฏิเสธคำขอลา');
    const leave = await this.getLeaveOrThrow(id, actor);
    if (leave.status !== 'PENDING') {
      throw new ConflictException('ปฏิเสธได้เฉพาะคำขอลาที่ยังรอการอนุมัติ');
    }

    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: dto.rejectionReason,
        decidedById: actor.userId,
        decidedAt: new Date(),
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: leave.userId,
        channel: 'IN_APP',
        category: 'LEAVE_DECISION',
        title: 'คำขอลาถูกปฏิเสธ',
        body: dto.rejectionReason,
        relatedEntityType: 'LeaveRequest',
        relatedEntityId: id,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'REJECT',
      entityType: 'LeaveRequest',
      entityId: id,
      afterJson: { status: 'REJECTED', rejectionReason: dto.rejectionReason },
    });

    return updated;
  }
}
