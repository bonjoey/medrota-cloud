import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiJobController } from './ai-job.controller';
import { AiJobService } from './ai-job.service';
import { AiQueueService } from './ai-queue.service';
import { AuditLogModule } from '../audit-log/audit-log.module';

/**
 * FR-AI01 (MVP 2 Sprint 5): Auto-suggest ตารางเวรด้วย AI แบบ Asynchronous Job Queue
 * (ADR-0002) — ส่งงานเข้า Redis/BullMQ โดยตรง ให้ services/ai (Python worker) ดึงไป
 * ประมวลผล ไม่ผ่าน HTTP เลย ต่างจาก AiServiceModule ที่ใช้สำหรับ Conflict Check แบบ Sync
 */
@Module({
  imports: [ConfigModule, AuditLogModule],
  controllers: [AiJobController],
  providers: [AiJobService, AiQueueService],
  exports: [AiJobService, AiQueueService],
})
export class AiJobModule {}
