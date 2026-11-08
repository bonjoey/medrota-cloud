import { Module } from '@nestjs/common';
import { ShiftSwapsService } from './shift-swaps.service';
import { ShiftSwapsController } from './shift-swaps.controller';
import { AiServiceModule } from '../ai-service/ai-service.module';

/** FR-U03, FR-A12, BP-02 (MVP 3 Sprint 9) */
@Module({
  imports: [AiServiceModule],
  providers: [ShiftSwapsService],
  controllers: [ShiftSwapsController],
  exports: [ShiftSwapsService],
})
export class ShiftSwapsModule {}
