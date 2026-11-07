import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — Single Source of Truth สำหรับการเข้าถึง Database
 *
 * ตาม ADR-0003: ทุก Repository ที่ query ตารางที่มี hospitalId ต้อง filter ด้วย
 * hospitalId จาก Request Context เสมอ (ป้องกัน Data Leak ข้าม Tenant) —
 * ดู RequestContextService และ TenantScopedRepository base class
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
