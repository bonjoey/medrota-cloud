import { Module } from '@nestjs/common';
import { SchedulingRulesService } from './scheduling-rules.service';
import { SchedulingRulesController } from './scheduling-rules.controller';

@Module({
  providers: [SchedulingRulesService],
  controllers: [SchedulingRulesController],
  exports: [SchedulingRulesService],
})
export class SchedulingRulesModule {}
