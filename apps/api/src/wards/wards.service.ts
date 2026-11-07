import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateWardDto } from './dto/create-ward.dto';

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
    });
  }

  async findOne(id: string, actor: ActorContext) {
    const ward = await this.prisma.ward.findFirst({
      where: { id, hospitalId: actor.hospitalId },
    });
    if (!ward) throw new NotFoundException('ไม่พบ Ward');
    return ward;
  }
}
