import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateWardDto } from './dto/create-ward.dto';
import { UpdateWardDto } from './dto/update-ward.dto';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
}

/** FR-A04: จัดการข้อมูล Ward, Department, อาคาร, ประเภทหอผู้ป่วย */
@Injectable()
export class WardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateWardDto, actor: ActorContext) {
    const ward = await this.prisma.ward.create({
      data: {
        hospitalId: actor.hospitalId,
        name: dto.name,
        wardType: dto.wardType,
        departmentId: dto.departmentId,
        building: dto.building,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CREATE',
      entityType: 'Ward',
      entityId: ward.id,
      afterJson: ward,
    });

    return ward;
  }

  findAll(actor: ActorContext) {
    return this.prisma.ward.findMany({
      where: { hospitalId: actor.hospitalId },
      orderBy: { name: 'asc' },
      include: { department: true },
    });
  }

  async findOne(id: string, actor: ActorContext) {
    const ward = await this.prisma.ward.findFirst({
      where: { id, hospitalId: actor.hospitalId },
      include: { department: true },
    });
    if (!ward) throw new NotFoundException('ไม่พบ Ward');
    return ward;
  }

  async update(id: string, dto: UpdateWardDto, actor: ActorContext) {
    const before = await this.findOne(id, actor);

    const ward = await this.prisma.ward.update({
      where: { id },
      data: {
        name: dto.name,
        wardType: dto.wardType,
        departmentId: dto.departmentId,
        building: dto.building,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'UPDATE',
      entityType: 'Ward',
      entityId: id,
      beforeJson: before,
      afterJson: ward,
    });

    return ward;
  }

  /** ป้องกันการลบ Ward ที่ยังมีบุคลากรหรือตารางเวรผูกอยู่ (รักษาความสมบูรณ์ของข้อมูล) */
  async remove(id: string, actor: ActorContext) {
    await this.findOne(id, actor);
    const [staffCount, scheduleCount] = await Promise.all([
      this.prisma.user.count({ where: { primaryWardId: id } }),
      this.prisma.schedule.count({ where: { wardId: id } }),
    ]);
    if (staffCount > 0 || scheduleCount > 0) {
      throw new ConflictException('ไม่สามารถลบ Ward ที่ยังมีบุคลากรหรือตารางเวรอยู่ได้');
    }

    await this.prisma.ward.delete({ where: { id } });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'DELETE',
      entityType: 'Ward',
      entityId: id,
    });

    return { success: true };
  }
}
