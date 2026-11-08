import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AiJobService } from './ai-job.service';
import { CreateScheduleSuggestDto } from './dto/create-schedule-suggest.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-AI01 (MVP 2 Sprint 5): Auto-suggest ตารางเวรด้วย AI — ดู ADR-0002 */
@Controller('ai-jobs')
export class AiJobController {
  constructor(private readonly aiJobService: AiJobService) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Post('schedule-suggest')
  enqueueScheduleSuggest(
    @Body() dto: CreateScheduleSuggestDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.aiJobService.enqueueScheduleSuggest(dto, actor);
  }

  // Poll สถานะด้วย Job ID (ADR-0002) — sync จาก BullMQ เข้า Postgres แบบ lazy ตอนเรียกนี้
  @Get(':id')
  getStatus(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.aiJobService.getStatus(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Post(':id/apply')
  apply(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.aiJobService.applySuggestion(id, actor);
  }
}
