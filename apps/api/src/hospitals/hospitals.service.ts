import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { UpdateHospitalDto } from './dto/update-hospital.dto';

interface ActorContext {
  userId: string;
  hospitalId: string;
  role: string;
}

/**
 * FR-A05: จัดการข้อมูลโรงพยาบาลและนโยบายการขึ้นเวรระดับองค์กร
 *
 * แต่ละ Tenant (โรงพยาบาล) มีระเบียน Hospital เดียว — endpoint นี้จึงอ่าน/แก้ไข
 * เฉพาะระเบียนของ hospitalId ที่ผูกกับผู้เรียกเท่านั้น ไม่มี create/delete ในชั้น API
 * (การสร้าง Tenant ใหม่เป็นขั้นตอน Onboarding ที่อยู่นอกขอบเขต MVP 1)
 */
@Injectable()
export class HospitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async getMine(actor: ActorContext) {
    const hospital = await this.prisma.hospital.findUnique({ where: { id: actor.hospitalId } });
    if (!hospital) throw new NotFoundException('ไม่พบข้อมูลโรงพยาบาล');
    return hospital;
  }

  async updateMine(dto: UpdateHospitalDto, actor: ActorContext) {
    const before = await this.getMine(actor);

    const hospital = await this.prisma.hospital.update({
      where: { id: actor.hospitalId },
      data: {
        name: dto.name,
        address: dto.address,
        logoUrl: dto.logoUrl,
        timezone: dto.timezone,
        minHoursPerMonth: dto.minHoursPerMonth,
        maxHoursPerMonth: dto.maxHoursPerMonth,
      },
    });

    await this.auditLog.record({
      hospitalId: actor.hospitalId,
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'UPDATE',
      entityType: 'Hospital',
      entityId: hospital.id,
      beforeJson: before,
      afterJson: hospital,
    });

    return hospital;
  }
}
