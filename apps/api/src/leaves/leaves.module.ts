import { Module } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { LeavesController } from './leaves.controller';
import { AiJobModule } from '../ai-job/ai-job.module';

/** FR-U04, FR-A13, BP-03 (MVP 3 Sprint 9) */
@Module({
  imports: [AiJobModule],
  providers: [LeavesService],
  controllers: [LeavesController],
  exports: [LeavesService],
})
export class LeavesModule {}
