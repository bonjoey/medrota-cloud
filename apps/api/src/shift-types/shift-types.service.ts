import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateShiftTypeDto } from './dto/create-shift-type.dto';
import { UpdateShiftTypeDto } from './dto/update-shift-type.dto';
import { computeShiftHours } from '../common/utils/shift-time.util';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
}

/** FR-A06: จัดการประเภทเวรและอัตราค่าตอบแทนต่อประเภทเวร */
@Injectable()
export class ShiftTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateShiftTypeDto, actor: ActorContext) {
    const existing = await this.prisma.shiftType.findUnique({
      where: { hospitalId_code: { hospitalId: actor.hospitalId, code: dto.code } },
    });
    if (existing) {
      throw new ConflictException('รหัสประเภทเวรนี้มีอยู่แล้วในโรงพยาบาลนี้');
    }

    const hours = computeShiftHours(dto.startTime, dto.endTime, dto.crossesMidnight ?? false);
    if (hours <= 0 || hours > 24) {
      throw new BadRequestException('ช่วงเวลาของเวรไม่สมเหตุสมผล (ต้องมากกว่า 0 และไม่เกิน 24 ชั่วโมง)');
    }

    const shiftType = await this.prisma.shiftType.create({
      data: {
        hospitalId: actor.hospitalId,
        code: dto.code,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        crossesMidnight: dto.crossesMidnight ?? false,
        compensationRate: dto.compensationRate,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CREATE',
      entityType: 'ShiftType',
      entityId: shiftType.id,
      afterJson: shiftType,
    });

    return shiftType;
  }

  findAll(actor: ActorContext) {
    return this.prisma.shiftType.findMany({
      where: { hospitalId: actor.hospitalId },
      orderBy: { startTime: 'asc' },
    });
  }

  async findOne(id: string, actor: ActorContext) {
    const shiftType = await this.prisma.shiftType.findFirst({
      where: { id, hospitalId: actor.hospitalId },
    });
    if (!shiftType) throw new NotFoundException('ไม่พบประเภทเวร');
    return shiftType;
  }

  async update(id: string, dto: UpdateShiftTypeDto, actor: ActorContext) {
    const before = await this.findOne(id, actor);

    if (dto.startTime || dto.endTime || dto.crossesMidnight !== undefined) {
      const hours = computeShiftHours(
        dto.startTime ?? before.startTime,
        dto.endTime ?? before.endTime,
        dto.crossesMidnight ?? before.crossesMidnight,
      );
      if (hours <= 0 || hours > 24) {
        throw new BadRequestException('ช่วงเวลาของเวรไม่สมเหตุสมผล (ต้องมากกว่า 0 และไม่เกิน 24 ชั่วโมง)');
      }
    }

    const shiftType = await this.prisma.shiftType.update({
      where: { id },
      data: {
        code: dto.code,
        name: dto.name,
        startTime: dto.startTime,
        endTime: dto.endTime,
        crossesMidnight: dto.crossesMidnight,
        compensationRate: dto.compensationRate,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'UPDATE',
      entityType: 'ShiftType',
      entityId: id,
      beforeJson: before,
      afterJson: shiftType,
    });

    return shiftType;
  }

  async remove(id: string, actor: ActorContext) {
    const shiftType = await this.findOne(id, actor);
    const usageCount = await this.prisma.scheduleAssignment.count({ where: { shiftTypeId: id } });
    if (usageCount > 0) {
      throw new ConflictException('ไม่สามารถลบประเภทเวรที่ถูกใช้งานในตารางเวรอยู่แล้วได้');
    }

    await this.prisma.shiftType.delete({ where: { id } });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'DELETE',
      entityType: 'ShiftType',
      entityId: id,
      beforeJson: shiftType,
    });

    return { success: true };
  }
}
