import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ShiftSwapsService } from './shift-swaps.service';
import { CreateShiftSwapDto } from './dto/create-shift-swap.dto';
import { CounterpartyDecisionDto, AdminDecisionDto } from './dto/decide-shift-swap.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-U03, FR-A12, BP-02 (MVP 3 Sprint 9): แลกเวร — ไม่มี @Roles() ระดับ Controller เพราะ
 * NURSE ต้องเสนอ/ตอบรับได้ ส่วน Admin ต้องอนุมัติขั้นสุดท้ายได้ (แยกสิทธิ์ที่ Service) */
@Controller('shift-swaps')
export class ShiftSwapsController {
  constructor(private readonly shiftSwapsService: ShiftSwapsService) {}

  @Post()
  create(@Body() dto: CreateShiftSwapDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.shiftSwapsService.create(dto, actor);
  }

  @Get()
  findAll(@Query('status') status: string | undefined, @CurrentUser() actor: CurrentUserPayload) {
    return this.shiftSwapsService.findAll(actor, { status });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.shiftSwapsService.findOne(id, actor);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.shiftSwapsService.cancel(id, actor);
  }

  // FR-U03: อีกฝ่าย (counterparty) ตอบรับ/ปฏิเสธ
  @Post(':id/counterparty-decision')
  counterpartyDecision(
    @Param('id') id: string,
    @Body() dto: CounterpartyDecisionDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.shiftSwapsService.counterpartyDecision(id, dto, actor);
  }

  // FR-A12: Admin อนุมัติขั้นสุดท้าย (ตรวจ Hard Constraint ซ้ำก่อนสลับจริง)
  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Post(':id/admin-decision')
  adminDecision(
    @Param('id') id: string,
    @Body() dto: AdminDecisionDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.shiftSwapsService.adminDecision(id, dto, actor);
  }
}
