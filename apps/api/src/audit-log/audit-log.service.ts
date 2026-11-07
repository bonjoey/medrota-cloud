import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface RecordAuditLogInput {
  hospitalId: string;
  actorId?: string;
  actorRole?: string;
  action: string; // "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "PUBLISH" | ...
  entityType: string;
  entityId: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  ipAddress?: string;
}

/**
 * NFR-03: บันทึก Audit Log ทุก Transaction ที่เปลี่ยนแปลงข้อมูล
 * เรียกใช้จาก Service ทุกตัวที่ทำ CREATE/UPDATE/DELETE/APPROVE/PUBLISH
 * (ดู AuditLogInterceptor สำหรับการบันทึกอัตโนมัติระดับ HTTP layer)
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        hospitalId: input.hospitalId,
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeJson: input.beforeJson as any,
        afterJson: input.afterJson as any,
        ipAddress: input.ipAddress,
      },
    });
  }
}
