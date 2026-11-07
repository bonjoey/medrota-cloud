import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
}

/** FR-A04: จัดการข้อมูลแผนก (Department) — เป็นชั้นบน Ward ในโครงสร้างองค์กร */
@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateDepartmentDto, actor: ActorContext) {
    const department = await this.prisma.department.create({
      data: { hospitalId: actor.hospitalId, name: dto.name },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'CREATE',
      entityType: 'Department',
      entityId: department.id,
      afterJson: department,
    });

    return department;
  }

  findAll(actor: ActorContext) {
    return this.prisma.department.findMany({
      where: { hospitalId: actor.hospitalId },
      orderBy: { name: 'asc' },
      include: { wards: true },
    });
  }

  async findOne(id: string, actor: ActorContext) {
    const department = await this.prisma.department.findFirst({
      where: { id, hospitalId: actor.hospitalId },
      include: { wards: true },
    });
    if (!department) throw new NotFoundException('ไม่พบแผนก');
    return department;
  }

  async update(id: string, dto: UpdateDepartmentDto, actor: ActorContext) {
    const before = await this.findOne(id, actor);

    const department = await this.prisma.department.update({
      where: { id },
      data: { name: dto.name },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'UPDATE',
      entityType: 'Department',
      entityId: id,
      beforeJson: before,
      afterJson: department,
    });

    return department;
  }

  async remove(id: string, actor: ActorContext) {
    const department = await this.findOne(id, actor);
    if (department.wards.length > 0) {
      throw new ConflictException('ไม่สามารถลบแผนกที่ยังมี Ward อยู่ภายใต้ได้');
    }

    await this.prisma.department.delete({ where: { id } });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'DELETE',
      entityType: 'Department',
      entityId: id,
      beforeJson: department,
    });

    return { success: true };
  }
}
