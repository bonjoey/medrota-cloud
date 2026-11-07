import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { ReportsService } from './reports.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-R01: รายงานสรุปตารางเวรประจำเดือน — ส่งออก PDF และ Excel */
@Controller('schedules/:id/export')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Get()
  async export(
    @Param('id') id: string,
    @Query('format') format: 'pdf' | 'xlsx' | undefined,
    @CurrentUser() actor: CurrentUserPayload,
    @Res() res: Response,
  ) {
    if (format === 'xlsx') {
      const buffer = await this.reportsService.generateExcel(id, actor);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="schedule-${id}.xlsx"`);
      res.send(buffer);
      return;
    }

    const buffer = await this.reportsService.generatePdf(id, actor);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="schedule-${id}.pdf"`);
    res.send(buffer);
  }
}
