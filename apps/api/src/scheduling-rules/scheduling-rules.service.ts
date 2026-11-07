import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateSchedulingRuleDto } from './dto/create-scheduling-rule.dto';
import { UpdateSchedulingRuleDto } from './dto/update-scheduling-rule.dto';
import { HARD_RULE_KEYS } from '../common/constants/rule-keys';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
}

interface FindAllQuery {
  wardId?: string;
}

/**
 * FR-A07: กฎระเบียบเวร — แยก Hard/Soft Constraint ตั้งแต่ชั้นข้อมูล
 *
 * ข้อควรระวังทางเทคนิค (MVP_ExecutionPlan Sprint 2): โครงสร้างข้อมูลของกฎในที่นี้คือ
 * สิ่งที่ MVP 2 Sprint 5 จะนำไปใช้เป็น Input ตรงของ OR-Tools CP-SAT Solver และที่
 * Sprint 3 FR-A10 จะใช้ตรวจสอบ ไม่ใช่ของที่ทำแล้วทิ้ง — ruleKey/parameters จึงต้อง
 * ตรงกับ Catalog ที่ services/ai รองรับจริงเสมอ (ดู common/constants/rule-keys.ts)
 */
@Injectable()
export class SchedulingRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private validateBusinessRules(dto: {
    ruleType: string;
    ruleKey: string;
    parameters: Record<string, unknown>;
    weight?: number;
  }) {
    if (dto.ruleType === 'SOFT' && (dto.weight === undefined || dto.weight === null)) {
      throw new BadRequestException('กฎประเภท Soft Constraint ต้องระบุค่า weight เสมอ');
    }
    if (dto.ruleType === 'HARD' && HARD_RULE_KEYS.includes(dto.ruleKey as (typeof HARD_RULE_KEYS)[number]) === false) {
      throw new BadRequestException(`ruleKey "${dto.ruleKey}" ไม่ใช่ Hard Constraint ที่ระบบรองรับ`);
    }

    // ตรวจรูปแบบ parameters ขั้นต่ำต่อ ruleKey เพื่อกันข้อมูลเพี้ยนไปถึง Solver/Conflict Check
    switch (dto.ruleKey) {
      case 'MIN_STAFF_PER_SHIFT':
        if (typeof dto.parameters.shiftCode !== 'string' || typeof dto.parameters.min !== 'number') {
          throw new BadRequestException(
            'MIN_STAFF_PER_SHIFT ต้องมี parameters = { shiftCode: string, min: number }',
          );
        }
        break;
      case 'MAX_CONSECUTIVE_NIGHT_SHIFTS':
        if (typeof dto.parameters.maxConsecutiveDays !== 'number') {
          throw new BadRequestException(
            'MAX_CONSECUTIVE_NIGHT_SHIFTS ต้องมี parameters = { maxConsecutiveDays: number, shiftCode?: string }',
          );
        }
        break;
      default:
        break;
    }
  }

  async create(dto: CreateSchedulingRuleDto, actor: ActorContext) {
    this.validateBusinessRules(dto);

    if (dto.wardId) {
      const ward = await this.prisma.ward.findFirst({
        where: { id: dto.wardId, hospitalId: actor.hospitalId },
      });
      if (!ward) throw new NotFoundException('ไม่พบ Ward ที่ระบุ');
    }

    const rule = await this.prisma.schedulingRule.create({
      data: {
        hospitalId: actor.hospitalId,
        wardId: dto.wardId,
        ruleType: dto.ruleType,
        ruleKey: dto.ruleKey,
        parameters: dto.parameters as object,
        weight: dto.ruleType === 'SOFT' ? dto.weight : null,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CREATE',
      entityType: 'SchedulingRule',
      entityId: rule.id,
      afterJson: rule,
    });

    return rule;
  }

  findAll(actor: ActorContext, query: FindAllQuery) {
    return this.prisma.schedulingRule.findMany({
      where: {
        hospitalId: actor.hospitalId,
        ...(query.wardId ? { OR: [{ wardId: query.wardId }, { wardId: null }] } : {}),
      },
      orderBy: [{ ruleType: 'asc' }, { ruleKey: 'asc' }],
    });
  }

  async findOne(id: string, actor: ActorContext) {
    const rule = await this.prisma.schedulingRule.findFirst({
      where: { id, hospitalId: actor.hospitalId },
    });
    if (!rule) throw new NotFoundException('ไม่พบกฎระเบียบเวร');
    return rule;
  }

  async update(id: string, dto: UpdateSchedulingRuleDto, actor: ActorContext) {
    const before = await this.findOne(id, actor);

    const merged = {
      ruleType: dto.ruleType ?? before.ruleType,
      ruleKey: dto.ruleKey ?? before.ruleKey,
      parameters: (dto.parameters ?? (before.parameters as unknown as Record<string, unknown>)) as Record<
        string,
        unknown
      >,
      weight: dto.weight ?? before.weight ?? undefined,
    };
    this.validateBusinessRules(merged);

    const rule = await this.prisma.schedulingRule.update({
      where: { id },
      data: {
        wardId: dto.wardId,
        ruleType: dto.ruleType,
        ruleKey: dto.ruleKey,
        parameters: dto.parameters as object,
        weight: merged.ruleType === 'SOFT' ? merged.weight : null,
        isActive: dto.isActive,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'UPDATE',
      entityType: 'SchedulingRule',
      entityId: id,
      beforeJson: before,
      afterJson: rule,
    });

    return rule;
  }

  /** ยืนยันค่าที่สอบเทียบแล้วจาก Workshop Sprint 0 (MVP_ExecutionPlan หัวข้อ 5) */
  async calibrate(id: string, actor: ActorContext) {
    const before = await this.findOne(id, actor);
    const rule = await this.prisma.schedulingRule.update({
      where: { id },
      data: { calibratedAt: new Date() },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CALIBRATE',
      entityType: 'SchedulingRule',
      entityId: id,
      beforeJson: before,
      afterJson: rule,
    });

    return rule;
  }

  async remove(id: string, actor: ActorContext) {
    const rule = await this.findOne(id, actor);
    await this.prisma.schedulingRule.delete({ where: { id } });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'DELETE',
      entityType: 'SchedulingRule',
      entityId: id,
      beforeJson: rule,
    });

    return { success: true };
  }
}
