import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpsertAssignmentDto } from './dto/upsert-assignment.dto';
import { computeShiftHours } from '../common/utils/shift-time.util';
import { assertWardScope, preferWardSpecificRules } from '../common/utils/scheduling-rules.util';
import { AiServiceClient, ConflictCheckResult } from '../ai-service/ai-service.client';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
  wardId?: string | null;
}

interface FindAllQuery {
  wardId?: string;
  month?: number;
  year?: number;
}

/**
 * FR-A08: สร้างตารางเวรประจำเดือนด้วยมือ (Grid) | FR-A09: แก้ไขพร้อม Change Log
 *
 * หมายเหตุสำคัญ (MVP_ExecutionPlan Sprint 3): การแก้ไขที่นี่เขียน ScheduleChangeLog
 * ทุกครั้งตั้งแต่ Sprint 2 แล้ว เพราะ Sprint 3 (FR-A09) ใช้โครงสร้างเดียวกันต่อ — ไม่ใช่
 * งานที่ทำแล้วทิ้ง การห้าม Double-booking (NO_DOUBLE_BOOKING) บังคับที่ชั้น DB
 * (@@unique([userId, date]) บน ScheduleAssignment) ให้ตรงกับ Hard Constraint เดียวกัน
 * ที่ services/ai ใช้ตอน AI จัดเวร (ADR-0002 — ห้ามมีตรรกะกฎสองชุดที่ขัดกันเอง)
 */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly aiServiceClient: AiServiceClient,
  ) {}

  async create(dto: CreateScheduleDto, actor: ActorContext) {
    const ward = await this.prisma.ward.findFirst({
      where: { id: dto.wardId, hospitalId: actor.hospitalId },
    });
    if (!ward) throw new NotFoundException('ไม่พบ Ward ที่ระบุ');
    assertWardScope(dto.wardId, actor);

    const existing = await this.prisma.schedule.findUnique({
      where: { wardId_month_year: { wardId: dto.wardId, month: dto.month, year: dto.year } },
    });
    if (existing) {
      throw new ConflictException('มีตารางเวรของ Ward นี้ในเดือน/ปีนี้อยู่แล้ว');
    }

    const schedule = await this.prisma.schedule.create({
      data: {
        hospitalId: actor.hospitalId,
        wardId: dto.wardId,
        month: dto.month,
        year: dto.year,
        status: 'DRAFT',
        source: 'MANUAL',
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CREATE',
      entityType: 'Schedule',
      entityId: schedule.id,
      afterJson: schedule,
    });

    return schedule;
  }

  findAll(actor: ActorContext, query: FindAllQuery) {
    return this.prisma.schedule.findMany({
      where: {
        hospitalId: actor.hospitalId,
        ...(query.wardId ? { wardId: query.wardId } : {}),
        ...(query.month ? { month: query.month } : {}),
        ...(query.year ? { year: query.year } : {}),
        ...(actor.role === 'HEAD_NURSE' ? { wardId: actor.wardId ?? undefined } : {}),
      },
      include: { ward: true },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  private async getScheduleOrThrow(id: string, actor: ActorContext) {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id, hospitalId: actor.hospitalId },
    });
    if (!schedule) throw new NotFoundException('ไม่พบตารางเวร');
    assertWardScope(schedule.wardId, actor);
    return schedule;
  }

  async findOne(id: string, actor: ActorContext) {
    const schedule = await this.getScheduleOrThrow(id, actor);
    const assignments = await this.prisma.scheduleAssignment.findMany({
      where: { scheduleId: id },
      include: {
        user: { select: { id: true, fullName: true, employeeCode: true, positionLevel: true } },
        shiftType: true,
      },
      orderBy: { date: 'asc' },
    });

    return {
      ...schedule,
      assignments,
      summary: this.computeSummary(assignments),
    };
  }

  /** FR-A08: สรุปจำนวนเวรและชั่วโมงรายบุคคลข้างตาราง (ให้ Admin มองเห็นความสมดุล) */
  private computeSummary(
    assignments: Array<{
      userId: string;
      user: { id: string; fullName: string; employeeCode: string };
      shiftType: { code: string; startTime: string; endTime: string; crossesMidnight: boolean };
    }>,
  ) {
    const byUser = new Map<
      string,
      { userId: string; fullName: string; employeeCode: string; totalShifts: number; totalHours: number; byShiftTypeCode: Record<string, number> }
    >();

    for (const a of assignments) {
      if (!byUser.has(a.userId)) {
        byUser.set(a.userId, {
          userId: a.userId,
          fullName: a.user.fullName,
          employeeCode: a.user.employeeCode,
          totalShifts: 0,
          totalHours: 0,
          byShiftTypeCode: {},
        });
      }
      const row = byUser.get(a.userId)!;
      row.totalShifts += 1;
      row.totalHours += computeShiftHours(a.shiftType.startTime, a.shiftType.endTime, a.shiftType.crossesMidnight);
      row.byShiftTypeCode[a.shiftType.code] = (row.byShiftTypeCode[a.shiftType.code] ?? 0) + 1;
    }

    return Array.from(byUser.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  async summary(id: string, actor: ActorContext) {
    const schedule = await this.findOne(id, actor);
    return schedule.summary;
  }

  /** FR-A09: ประวัติการแก้ไขตารางเวร (ผู้แก้ไข + เวลา + ก่อน/หลัง) */
  async changeLogs(id: string, actor: ActorContext) {
    await this.getScheduleOrThrow(id, actor);
    return this.prisma.scheduleChangeLog.findMany({
      where: { scheduleId: id },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** FR-A08/FR-A09: กำหนด/แก้ไขเวร 1 ช่อง — ห้ามแก้ตารางที่ Published แล้ว */
  async upsertAssignment(scheduleId: string, dto: UpsertAssignmentDto, actor: ActorContext) {
    const schedule = await this.getScheduleOrThrow(scheduleId, actor);
    if (schedule.status === 'PUBLISHED') {
      throw new ConflictException('ตารางเวรที่ประกาศใช้แล้วไม่สามารถแก้ไขผ่านช่องทางนี้ได้');
    }

    const assignmentDate = new Date(dto.date);
    if (assignmentDate.getFullYear() !== schedule.year || assignmentDate.getMonth() + 1 !== schedule.month) {
      throw new BadRequestException('วันที่ที่ระบุไม่อยู่ในเดือน/ปีของตารางเวรนี้');
    }

    const [user, shiftType] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: dto.userId, hospitalId: actor.hospitalId } }),
      this.prisma.shiftType.findFirst({ where: { id: dto.shiftTypeId, hospitalId: actor.hospitalId } }),
    ]);
    if (!user) throw new NotFoundException('ไม่พบบุคลากรที่ระบุ');
    if (!shiftType) throw new NotFoundException('ไม่พบประเภทเวรที่ระบุ');

    // NO_DOUBLE_BOOKING (Hard Constraint — บังคับระดับ DB เดียวกับฝั่ง AI Solver)
    const existing = await this.prisma.scheduleAssignment.findUnique({
      where: { userId_date: { userId: dto.userId, date: assignmentDate } },
    });

    if (existing && existing.scheduleId !== scheduleId) {
      throw new ConflictException(
        `${user.fullName} มีเวรมอบหมายในวันนี้อยู่แล้วในตารางเวรอื่น (ห้ามมอบหมายเวรซ้อนทับ — NO_DOUBLE_BOOKING)`,
      );
    }

    let assignment;
    if (existing) {
      const before = existing;
      assignment = await this.prisma.scheduleAssignment.update({
        where: { id: existing.id },
        data: { shiftTypeId: dto.shiftTypeId, isManualOverride: true },
        include: { shiftType: true, user: { select: { fullName: true, employeeCode: true } } },
      });
      await this.prisma.scheduleChangeLog.create({
        data: {
          scheduleId,
          changedById: actor.userId,
          changeType: 'MANUAL_EDIT',
          beforeJson: before as object,
          afterJson: assignment as object,
        },
      });
    } else {
      assignment = await this.prisma.scheduleAssignment.create({
        data: {
          scheduleId,
          userId: dto.userId,
          shiftTypeId: dto.shiftTypeId,
          date: assignmentDate,
          isManualOverride: true,
        },
        include: { shiftType: true, user: { select: { fullName: true, employeeCode: true } } },
      });
      await this.prisma.scheduleChangeLog.create({
        data: {
          scheduleId,
          changedById: actor.userId,
          changeType: 'MANUAL_EDIT',
          afterJson: assignment as object,
        },
      });
    }

    return assignment;
  }

  async removeAssignment(scheduleId: string, assignmentId: string, actor: ActorContext) {
    const schedule = await this.getScheduleOrThrow(scheduleId, actor);
    if (schedule.status === 'PUBLISHED') {
      throw new ConflictException('ตารางเวรที่ประกาศใช้แล้วไม่สามารถแก้ไขผ่านช่องทางนี้ได้');
    }

    const assignment = await this.prisma.scheduleAssignment.findFirst({
      where: { id: assignmentId, scheduleId },
    });
    if (!assignment) throw new NotFoundException('ไม่พบช่องเวรที่ระบุ');

    await this.prisma.scheduleAssignment.delete({ where: { id: assignmentId } });
    await this.prisma.scheduleChangeLog.create({
      data: {
        scheduleId,
        changedById: actor.userId,
        changeType: 'MANUAL_EDIT',
        beforeJson: assignment as object,
        reason: 'ลบเวรออกจากตาราง',
      },
    });

    return { success: true };
  }

  /**
   * FR-A10 (Sprint 3): ตรวจความขัดแย้งของตารางเวรกับกฎระเบียบทุกข้อ "ในโหมดตรวจสอบ"
   * โดยส่งข้อมูลให้ services/ai ประเมิน (ADR-0002 — ตรรกะกฎชุดเดียวกับที่ AI Solver ใช้)
   *
   * การเลือกกฎ: ใช้กฎระดับ Ward ก่อน ถ้า ruleKey+shiftCode เดียวกันมีทั้งระดับ Ward และ
   * ระดับโรงพยาบาล ให้ใช้ของ Ward เท่านั้น (CON-03 — Ward override นโยบาย default)
   */
  async checkConflicts(id: string, actor: ActorContext): Promise<ConflictCheckResult> {
    const schedule = await this.getScheduleOrThrow(id, actor);

    const [assignments, rules, shiftTypes] = await Promise.all([
      this.prisma.scheduleAssignment.findMany({
        where: { scheduleId: id },
        include: { shiftType: true },
      }),
      this.prisma.schedulingRule.findMany({
        where: {
          hospitalId: actor.hospitalId,
          ruleType: 'HARD',
          isActive: true,
          OR: [{ wardId: schedule.wardId }, { wardId: null }],
        },
      }),
      this.prisma.shiftType.findMany({ where: { hospitalId: actor.hospitalId } }),
    ]);

    const dedupedRules = preferWardSpecificRules(rules);

    const result = await this.aiServiceClient.checkConflicts({
      hospital_id: actor.hospitalId,
      ward_id: schedule.wardId,
      month: schedule.month,
      year: schedule.year,
      assignments: assignments.map((a) => ({
        assignment_id: a.id,
        user_id: a.userId,
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
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // FR-A11: Workflow การอนุมัติตารางเวร Draft → Review → Approved → Published
  // -------------------------------------------------------------------------

  /** FR-A11 ขั้นที่ 1: ส่งตารางเวรเข้าสู่กระบวนการตรวจทาน (DRAFT → REVIEW) */
  async submitForReview(id: string, actor: ActorContext) {
    return this.transition(id, actor, 'DRAFT', 'REVIEW', 'SUBMIT_FOR_REVIEW');
  }

  /**
   * FR-A11 ขั้นที่ 2: อนุมัติตารางเวร (REVIEW → APPROVED)
   * ต้องผ่าน FR-A10 Conflict Check ก่อนเสมอ — ห้ามอนุมัติตารางที่ยังมีข้อขัดแย้งกับ
   * Hard Constraint (ตาม MVP_ExecutionPlan Sprint 3 "ตารางที่ผิดกฎถูกจับได้ก่อนบันทึกทุกกรณี")
   */
  async approve(id: string, actor: ActorContext) {
    const conflictResult = await this.checkConflicts(id, actor);
    if (!conflictResult.is_valid) {
      throw new ConflictException({
        message: `ไม่สามารถอนุมัติได้ — ตารางเวรยังมีข้อขัดแย้งกับกฎระเบียบ ${conflictResult.violations.length} รายการ`,
        violations: conflictResult.violations,
      });
    }
    return this.transition(id, actor, 'REVIEW', 'APPROVED', 'APPROVE');
  }

  /**
   * FR-A11 ขั้นที่ 3: ประกาศใช้ตารางเวร (APPROVED → PUBLISHED) — หลังจากนี้บุคลากรเห็น
   * ตารางได้ (FR-U01/U02) และห้ามแก้ไขผ่าน upsertAssignment/removeAssignment อีก
   */
  async publish(id: string, actor: ActorContext) {
    const schedule = await this.transition(id, actor, 'APPROVED', 'PUBLISHED', 'PUBLISH');
    await this.prisma.schedule.update({
      where: { id },
      data: { publishedAt: new Date(), publishedById: actor.userId },
    });
    return schedule;
  }

  /** ตีกลับให้แก้ไข — REVIEW/APPROVED → DRAFT พร้อมเหตุผล (ไม่ใช่ FR เฉพาะ แต่จำเป็นต่อการใช้งานจริง) */
  async sendBackToDraft(id: string, actor: ActorContext, reason: string) {
    const schedule = await this.getScheduleOrThrow(id, actor);
    if (schedule.status !== 'REVIEW' && schedule.status !== 'APPROVED') {
      throw new ConflictException('ตีกลับได้เฉพาะตารางที่อยู่ในสถานะ Review หรือ Approved เท่านั้น');
    }
    return this.transition(id, actor, schedule.status, 'DRAFT', 'STATUS_CHANGE', reason);
  }

  private async transition(
    id: string,
    actor: ActorContext,
    fromStatus: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED',
    toStatus: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PUBLISHED',
    changeType: string,
    reason?: string,
  ) {
    const schedule = await this.getScheduleOrThrow(id, actor);
    if (schedule.status !== fromStatus) {
      throw new ConflictException(
        `ไม่สามารถเปลี่ยนสถานะจาก ${schedule.status} เป็น ${toStatus} ได้ (ต้องอยู่ในสถานะ ${fromStatus} ก่อน)`,
      );
    }

    const updated = await this.prisma.schedule.update({
      where: { id },
      data: { status: toStatus },
    });

    await this.prisma.scheduleChangeLog.create({
      data: {
        scheduleId: id,
        changedById: actor.userId,
        changeType: 'STATUS_CHANGE',
        beforeJson: { status: fromStatus },
        afterJson: { status: toStatus },
        reason,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: changeType,
      entityType: 'Schedule',
      entityId: id,
      beforeJson: { status: fromStatus },
      afterJson: { status: toStatus },
    });

    return updated;
  }
}
