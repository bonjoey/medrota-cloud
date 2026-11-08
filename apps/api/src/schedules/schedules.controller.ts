import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpsertAssignmentDto } from './dto/upsert-assignment.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';
import { AiJobService } from '../ai-job/ai-job.service';
import { CreateIncrementalResolveDto } from '../ai-job/dto/create-incremental-resolve.dto';

/** FR-A08: สร้างตารางเวรประจำเดือนด้วยมือ | FR-A09: แก้ไขพร้อม Change Log */
@Controller('schedules')
export class SchedulesController {
  constructor(
    private readonly schedulesService: SchedulesService,
    private readonly aiJobService: AiJobService,
  ) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Post()
  create(@Body() dto: CreateScheduleDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulesService.create(dto, actor);
  }

  @Get()
  findAll(
    @Query('wardId') wardId: string | undefined,
    @Query('month') month: string | undefined,
    @Query('year') year: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.schedulesService.findAll(actor, {
      wardId,
      month: month ? Number(month) : undefined,
      year: year ? Number(year) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulesService.findOne(id, actor);
  }

  @Get(':id/summary')
  summary(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulesService.summary(id, actor);
  }

  // FR-A10: ตรวจความขัดแย้งกับกฎระเบียบทุกข้อ (โหมดตรวจสอบ) — ไม่แก้ไขข้อมูลใด ๆ
  @Post(':id/check-conflicts')
  checkConflicts(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulesService.checkConflicts(id, actor);
  }

  // FR-A09: ประวัติการแก้ไขตารางเวร
  @Get(':id/change-logs')
  changeLogs(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulesService.changeLogs(id, actor);
  }

  // FR-AI01 ขั้นที่ 5 (MVP 2 Sprint 8): ขอให้ AI จัดเวรใหม่เฉพาะช่วงวันที่ระบุ — ใช้ได้แม้
  // ตารางเวรนี้ Published แล้ว (ต่างจาก upsertAssignment/removeAssignment ด้านล่าง)
  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Post(':id/incremental-resolve')
  incrementalResolve(
    @Param('id') id: string,
    @Body() dto: CreateIncrementalResolveDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.aiJobService.enqueueIncrementalResolve(id, dto, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Put(':id/assignments')
  upsertAssignment(
    @Param('id') id: string,
    @Body() dto: UpsertAssignmentDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.schedulesService.upsertAssignment(id, dto, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Delete(':id/assignments/:assignmentId')
  removeAssignment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.schedulesService.removeAssignment(id, assignmentId, actor);
  }

  // -------------------------------------------------------------------------
  // FR-A11: Workflow การอนุมัติ Draft → Review → Approved → Published
  // -------------------------------------------------------------------------

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Post(':id/submit-review')
  submitForReview(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulesService.submitForReview(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulesService.approve(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulesService.publish(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post(':id/send-back')
  sendBack(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.schedulesService.sendBackToDraft(id, actor, reason);
  }
}
