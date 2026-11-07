import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SchedulingRulesService } from './scheduling-rules.service';
import { CreateSchedulingRuleDto } from './dto/create-scheduling-rule.dto';
import { UpdateSchedulingRuleDto } from './dto/update-scheduling-rule.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-A07: บันทึกกฎระเบียบเวร */
@Controller('scheduling-rules')
export class SchedulingRulesController {
  constructor(private readonly schedulingRulesService: SchedulingRulesService) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post()
  create(@Body() dto: CreateSchedulingRuleDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulingRulesService.create(dto, actor);
  }

  @Get()
  findAll(@Query('wardId') wardId: string | undefined, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulingRulesService.findAll(actor, { wardId });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulingRulesService.findOne(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSchedulingRuleDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.schedulingRulesService.update(id, dto, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post(':id/calibrate')
  calibrate(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulingRulesService.calibrate(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.schedulingRulesService.remove(id, actor);
  }
}
