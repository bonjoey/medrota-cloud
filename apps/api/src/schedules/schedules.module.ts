import { Module } from '@nestjs/common';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { AiServiceModule } from '../ai-service/ai-service.module';
import { AiJobModule } from '../ai-job/ai-job.module';

@Module({
  imports: [AiServiceModule, AiJobModule],
  providers: [SchedulesService],
  controllers: [SchedulesController],
  exports: [SchedulesService],
})
export class SchedulesModule {}
