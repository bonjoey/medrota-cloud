import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

/**
 * ADR-0002 + MVP 2 Sprint 5: Queue (Redis/BullMQ) ที่ NestJS เป็นผู้ส่งงาน (Producer)
 * โดยตรง — services/ai (Python, app/worker.py) เป็นผู้ดึงงานจาก Queue ชื่อเดียวกันนี้
 * โดยตรงเช่นกัน ไม่ผ่าน HTTP เลย ชื่อ Queue และรูปแบบ job.data ต้องตรงกันทั้งสองฝั่งเป๊ะ ๆ
 * (ดู services/ai/app/worker.py สำหรับสัญญาฝั่ง Python)
 */
@Injectable()
export class AiQueueService implements OnModuleDestroy {
  readonly queue: Queue;

  constructor(private readonly config: ConfigService) {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const queueName = this.config.get<string>('AI_JOB_QUEUE_NAME') ?? 'ai-jobs';
    // bullmq (Node) ต้องการ ConnectionOptions เป็น object ({ url }) ไม่รับ string ตรง ๆ
    // (ต่างจาก bullmq (Python) ฝั่ง services/ai/app/worker.py ที่รับ string ได้เลย)
    this.queue = new Queue(queueName, { connection: { url: redisUrl } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
