import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * Global module เพราะ AuditLogService ถูกเรียกจากทุก Feature module
 * (Users, Schedules, Leaves, Swaps, Overtime, ฯลฯ) ตาม NFR-03
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
