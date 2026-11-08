import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AiQueueService } from './ai-queue.service';
import { CreateScheduleSuggestDto } from './dto/create-schedule-suggest.dto';
import { CreateIncrementalResolveDto } from './dto/create-incremental-resolve.dto';
import { assertWardScope, preferWardSpecificRules } from '../common/utils/scheduling-rules.util';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

interface AssignmentExplanation {
  user_id: string;
  date: string;
  shift_type_code: string;
  reasons: string[];
  change_impact_if_swapped?: string | null;
}

interface ScheduleSuggestResult {
  status: 'OPTIMAL' | 'TIMEOUT_BEST_EFFORT' | 'INFEASIBLE';
  assignments: AssignmentExplanation[];
  quality_score?: Record<string, unknown> | null;
  infeasible_reason?: {
    conflicting_rule_keys: string[];
    explanation: string;
    suggested_relaxations: string[];
  } | null;
  solve_time_seconds: number;
}

/**
 * FR-AI01 (MVP 2 Sprint 5): Auto-suggest ตารางเวรด้วย AI
 *
 * หน้าที่: สร้าง AiJob แล้วส่งเข้า Queue (Producer) → ให้ Python worker ดึงไปประมวลผล
 * (ADR-0002) → poll สถานะ (lazy-sync จาก BullMQ เข้า Postgres ตอนถูกเรียก) → นำผลไปสร้าง
 * Schedule จริงตอน apply — NestJS เป็นเจ้าของข้อมูลเสมอ (Python ไม่แตะ Postgres ตรง ๆ)
 */
@Injectable()
export class AiJobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly aiQueue: AiQueueService,
  ) {}

  async enqueueScheduleSuggest(dto: CreateScheduleSuggestDto, actor: CurrentUserPayload) {
    assertWardScope(dto.wardId, actor);
    const payload = await this.buildSuggestPayload(dto.wardId, dto.month, dto.year, actor);

    const aiJob = await this.prisma.aiJob.create({
      data: {
        jobType: 'SCHEDULE_SUGGEST',
        hospitalId: actor.hospitalId,
        wardId: dto.wardId,
        status: 'QUEUED',
        requestPayload: payload as object,
      },
    });

    // bullmq jobId = AiJob.id เดียวกันเป๊ะ ๆ — ไม่ต้องมีคอลัมน์แยกมาจับคู่สองฝั่ง
    await this.aiQueue.queue.add(
      'SCHEDULE_SUGGEST',
      { ai_job_id: aiJob.id, payload },
      { jobId: aiJob.id },
    );

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'AI_SCHEDULE_SUGGEST_ENQUEUE',
      entityType: 'AiJob',
      entityId: aiJob.id,
      afterJson: { status: aiJob.status, wardId: dto.wardId, month: dto.month, year: dto.year },
    });

    return { aiJobId: aiJob.id, status: aiJob.status };
  }

  /**
   * FR-AI01 ขั้นที่ 5 (MVP 2 Sprint 8): จัดเวรใหม่เฉพาะช่วงวันที่ระบุของตารางเวรที่มีอยู่
   * แล้ว — วันนอกช่วงถูกตรึงด้วย fixed_assignments ทั้งหมด (ไม่กระทบคนอื่นที่ไม่เกี่ยวข้อง)
   * ใช้ได้กับตารางเวรทุกสถานะรวมถึง PUBLISHED (ต่างจาก upsertAssignment ที่ห้ามแก้ตาราง
   * ที่ประกาศใช้แล้ว) เพราะเป็นช่องทางที่ผ่าน AI ตรวจ Hard Constraint ซ้ำเสมอ ไม่ใช่แก้มือดิบ ๆ
   */
  async enqueueIncrementalResolve(
    scheduleId: string,
    dto: CreateIncrementalResolveDto,
    actor: CurrentUserPayload,
  ) {
    const schedule = await this.prisma.schedule.findFirst({
      where: { id: scheduleId, hospitalId: actor.hospitalId },
    });
    if (!schedule) throw new NotFoundException('ไม่พบตารางเวร');
    assertWardScope(schedule.wardId, actor);

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) {
      throw new BadRequestException('ช่วงวันที่ไม่ถูกต้อง (วันสิ้นสุดต้องไม่ก่อนวันเริ่ม)');
    }

    const monthStart = new Date(schedule.year, schedule.month - 1, 1);
    const monthEnd = new Date(schedule.year, schedule.month, 0);
    if (startDate < monthStart || endDate > monthEnd) {
      throw new BadRequestException('ช่วงวันที่ต้องอยู่ภายในเดือน/ปีของตารางเวรนี้');
    }

    const [basePayload, existingAssignments] = await Promise.all([
      this.buildSuggestPayload(schedule.wardId, schedule.month, schedule.year, actor),
      this.prisma.scheduleAssignment.findMany({
        where: { scheduleId },
        include: { shiftType: true },
      }),
    ]);

    const fixedAssignments = existingAssignments.map((a) => ({
      assignment_id: a.id,
      user_id: a.userId,
      date: a.date.toISOString().slice(0, 10),
      shift_type_code: a.shiftType.code,
    }));

    const payload = {
      ...basePayload,
      fixed_assignments: fixedAssignments,
      resolve_window: { start_date: dto.startDate, end_date: dto.endDate },
    };

    const aiJob = await this.prisma.aiJob.create({
      data: {
        jobType: 'INCREMENTAL_RESOLVE',
        hospitalId: actor.hospitalId,
        wardId: schedule.wardId,
        status: 'QUEUED',
        requestPayload: payload as object,
      },
    });

    await this.aiQueue.queue.add(
      'INCREMENTAL_RESOLVE',
      { ai_job_id: aiJob.id, payload },
      { jobId: aiJob.id },
    );

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'AI_INCREMENTAL_RESOLVE_ENQUEUE',
      entityType: 'AiJob',
      entityId: aiJob.id,
      afterJson: { scheduleId, startDate: dto.startDate, endDate: dto.endDate, reason: dto.reason },
    });

    return { aiJobId: aiJob.id, status: aiJob.status };
  }

  async getStatus(aiJobId: string, actor: CurrentUserPayload) {
    const aiJob = await this.getAiJobOrThrow(aiJobId, actor);
    if (aiJob.status === 'QUEUED' || aiJob.status === 'RUNNING') {
      await this.syncFromQueue(aiJob.id, aiJob.status, aiJob.startedAt);
      return this.getAiJobOrThrow(aiJobId, actor);
    }
    return aiJob;
  }

  async applySuggestion(aiJobId: string, actor: CurrentUserPayload) {
    const aiJob = await this.getStatus(aiJobId, actor);
    if (aiJob.status !== 'SUCCEEDED') {
      throw new ConflictException(
        'งาน AI นี้ยังไม่เสร็จหรือไม่สำเร็จ (อาจเป็น Infeasible) จึงยังนำไปสร้างตารางเวรไม่ได้',
      );
    }
    if (!aiJob.wardId) {
      throw new BadRequestException('AiJob นี้ไม่ได้ผูกกับ Ward ใด ๆ');
    }
    assertWardScope(aiJob.wardId, actor);

    const requestPayload = aiJob.requestPayload as unknown as { month: number; year: number };
    const result = aiJob.resultPayload as unknown as ScheduleSuggestResult;

    const existingSchedule = await this.prisma.schedule.findUnique({
      where: {
        wardId_month_year: { wardId: aiJob.wardId, month: requestPayload.month, year: requestPayload.year },
      },
    });
    if (existingSchedule && existingSchedule.status === 'PUBLISHED') {
      throw new ConflictException('ตารางเวรเดือนนี้ประกาศใช้แล้ว ไม่สามารถแทนที่ด้วยผลเสนอของ AI ได้');
    }

    const shiftTypes = await this.prisma.shiftType.findMany({ where: { hospitalId: actor.hospitalId } });
    const shiftTypeByCode = new Map(shiftTypes.map((s) => [s.code, s]));

    const scheduleId = await this.prisma.$transaction(async (tx) => {
      const scheduleRow = existingSchedule
        ? await tx.schedule.update({
            where: { id: existingSchedule.id },
            data: {
              source: 'AI',
              aiJobId: aiJob.id,
              qualityScore: (result.quality_score ?? null) as object,
            },
          })
        : await tx.schedule.create({
            data: {
              hospitalId: actor.hospitalId,
              wardId: aiJob.wardId as string,
              month: requestPayload.month,
              year: requestPayload.year,
              status: 'DRAFT',
              source: 'AI',
              aiJobId: aiJob.id,
              qualityScore: (result.quality_score ?? null) as object,
            },
          });

      if (existingSchedule) {
        await tx.scheduleAssignment.deleteMany({ where: { scheduleId: scheduleRow.id } });
      }

      const rows = result.assignments
        .map((a) => {
          const shiftType = shiftTypeByCode.get(a.shift_type_code);
          if (!shiftType) return null;
          return {
            scheduleId: scheduleRow.id,
            userId: a.user_id,
            shiftTypeId: shiftType.id,
            date: new Date(a.date),
            explanation: {
              reasons: a.reasons,
              change_impact_if_swapped: a.change_impact_if_swapped ?? null,
            } as object,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length > 0) {
        await tx.scheduleAssignment.createMany({ data: rows });
      }

      await tx.scheduleChangeLog.create({
        data: {
          scheduleId: scheduleRow.id,
          changedById: actor.userId,
          changeType: aiJob.jobType === 'INCREMENTAL_RESOLVE' ? 'INCREMENTAL_RESOLVE' : 'AI_RESOLVE',
          afterJson: { aiJobId: aiJob.id, assignmentCount: rows.length } as object,
        },
      });

      return scheduleRow.id;
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'AI_SCHEDULE_APPLY',
      entityType: 'Schedule',
      entityId: scheduleId,
      afterJson: { aiJobId: aiJob.id },
    });

    return this.prisma.schedule.findUnique({ where: { id: scheduleId } });
  }

  private async getAiJobOrThrow(id: string, actor: CurrentUserPayload) {
    const aiJob = await this.prisma.aiJob.findFirst({ where: { id, hospitalId: actor.hospitalId } });
    if (!aiJob) throw new NotFoundException('ไม่พบงาน AI นี้');
    if (aiJob.wardId) assertWardScope(aiJob.wardId, actor);
    return aiJob;
  }

  /**
   * ADR-0002 ("NestJS poll ผ่าน Job ID"): sync สถานะล่าสุดจาก BullMQ เข้า Postgres แบบ
   * lazy ตอนถูก poll เท่านั้น (ไม่ต้องมี listener process แยก) — Python ไม่แตะ Postgres เลย
   */
  private async syncFromQueue(
    aiJobId: string,
    currentStatus: string,
    startedAt: Date | null,
  ): Promise<void> {
    const job = await this.aiQueue.queue.getJob(aiJobId);
    if (!job) return;

    const state = await job.getState();

    if (state === 'completed') {
      const result = job.returnvalue as ScheduleSuggestResult;
      const isInfeasible = result?.status === 'INFEASIBLE';
      await this.prisma.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: isInfeasible ? 'FAILED' : 'SUCCEEDED',
          resultPayload: result as unknown as object,
          infeasibleReason: isInfeasible ? (result.infeasible_reason as unknown as object) : undefined,
          finishedAt: new Date(),
          startedAt: startedAt ?? new Date(job.processedOn ?? Date.now()),
        },
      });
      return;
    }

    if (state === 'failed') {
      await this.prisma.aiJob.update({
        where: { id: aiJobId },
        data: {
          status: 'FAILED',
          infeasibleReason: {
            conflicting_rule_keys: [],
            explanation: job.failedReason ?? 'Job ล้มเหลวโดยไม่ทราบสาเหตุ',
            suggested_relaxations: [],
          } as object,
          finishedAt: new Date(),
        },
      });
      return;
    }

    if (state === 'active' && currentStatus === 'QUEUED') {
      await this.prisma.aiJob.update({
        where: { id: aiJobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
    }
  }

  /** สร้าง payload ตามสัญญา ScheduleSuggestRequest (services/ai/app/schemas.py) เป๊ะ ๆ (ADR-0002) */
  private async buildSuggestPayload(
    wardId: string,
    month: number,
    year: number,
    actor: CurrentUserPayload,
  ) {
    const ward = await this.prisma.ward.findFirst({ where: { id: wardId, hospitalId: actor.hospitalId } });
    if (!ward) throw new NotFoundException('ไม่พบ Ward ที่ระบุ');

    const [staff, shiftTypes, rules, approvedLeaves] = await Promise.all([
      this.prisma.user.findMany({
        where: { hospitalId: actor.hospitalId, primaryWardId: wardId, status: 'ACTIVE' },
      }),
      this.prisma.shiftType.findMany({ where: { hospitalId: actor.hospitalId } }),
      this.prisma.schedulingRule.findMany({
        where: { hospitalId: actor.hospitalId, isActive: true, OR: [{ wardId: null }, { wardId }] },
      }),
      this.prisma.leaveRequest.findMany({
        where: { status: 'APPROVED', user: { primaryWardId: wardId } },
      }),
    ]);

    const dedupedRules = preferWardSpecificRules(rules);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);

    return {
      hospital_id: actor.hospitalId,
      ward_id: wardId,
      month,
      year,
      staff: staff.map((u) => ({ user_id: u.id, position_level: u.positionLevel, ward_id: wardId })),
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
        parameters: r.parameters as Record<string, unknown>,
        weight: r.weight ?? undefined,
      })),
      approved_leaves: approvedLeaves
        .filter((l) => l.startDate <= monthEnd && l.endDate >= monthStart)
        .map((l) => ({
          user_id: l.userId,
          start_date: l.startDate.toISOString().slice(0, 10),
          end_date: l.endDate.toISOString().slice(0, 10),
        })),
      time_limit_seconds: 60,
    };
  }
}
