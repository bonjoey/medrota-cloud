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

/** FR-R07/FR-R08 (Could Have, MVP 3 Sprint 10): รายงานวิเคราะห์ — คนละ Controller เพราะ
 * ไม่ได้ผูกกับ Schedule ใบใดใบหนึ่ง (เป็นรายงานสรุปข้ามเดือน/ปี) */
@Controller('reports')
export class ReportsAnalyticsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Get('shift-swaps')
  shiftSwapHistory(
    @Query('month') month: string,
    @Query('year') year: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.reportsService.shiftSwapHistory(actor, { month: Number(month), year: Number(year) });
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Get('leave-analysis')
  leaveAnalysis(@Query('year') year: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.reportsService.leaveAnalysis(actor, { year: Number(year) });
  }
}
