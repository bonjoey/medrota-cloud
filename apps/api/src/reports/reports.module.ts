import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsController, ReportsAnalyticsController } from './reports.controller';

@Module({
  providers: [ReportsService],
  controllers: [ReportsController, ReportsAnalyticsController],
})
export class ReportsModule {}
