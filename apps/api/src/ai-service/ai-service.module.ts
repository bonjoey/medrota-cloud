import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AiServiceClient } from './ai-service.client';

/**
 * ADR-0002: ชั้นเชื่อมต่อ NestJS <-> Python AI Service (services/ai)
 * - Conflict Check (FR-A10) เรียกแบบ Synchronous REST (เร็ว ไม่ต้องผ่าน Job Queue)
 * - Schedule Suggest/Forecast (FR-AI01/02) เรียกแบบ Asynchronous Job Queue (Sprint 5+)
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseURL: config.get<string>('AI_SERVICE_BASE_URL') ?? 'http://localhost:8000',
        timeout: 15_000,
      }),
    }),
  ],
  providers: [AiServiceClient],
  exports: [AiServiceClient],
})
export class AiServiceModule {}
