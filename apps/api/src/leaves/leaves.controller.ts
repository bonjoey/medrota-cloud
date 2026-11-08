import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { LeavesService } from './leaves.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { RejectLeaveRequestDto } from './dto/decide-leave-request.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-U04, FR-A13, BP-03 (MVP 3 Sprint 9): คำขอลา — ไม่มี @Roles() ระดับ Controller เพราะ
 * NURSE ต้องยื่น/ดูของตนเองได้ ส่วน HEAD_NURSE/WARD_ADMIN/SUPER_ADMIN ต้องอนุมัติได้ —
 * แยกสิทธิ์ละเอียดในแต่ละ handler/Service แทน (เหมือน NursePortalController) */
@Controller('leaves')
export class LeavesController {
  constructor(private readonly leavesService: LeavesService) {}

  @Post()
  create(@Body() dto: CreateLeaveRequestDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.leavesService.create(dto, actor);
  }

  @Get()
  findAll(
    @Query('status') status: string | undefined,
    @Query('userId') userId: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.leavesService.findAll(actor, { status, userId });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.leavesService.findOne(id, actor);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.leavesService.cancel(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.leavesService.approve(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectLeaveRequestDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.leavesService.reject(id, dto, actor);
  }
}
