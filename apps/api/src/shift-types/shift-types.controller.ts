import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { ShiftTypesService } from './shift-types.service';
import { CreateShiftTypeDto } from './dto/create-shift-type.dto';
import { UpdateShiftTypeDto } from './dto/update-shift-type.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-A06: จัดการประเภทเวรและอัตราค่าตอบแทน */
@Controller('shift-types')
export class ShiftTypesController {
  constructor(private readonly shiftTypesService: ShiftTypesService) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post()
  create(@Body() dto: CreateShiftTypeDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.shiftTypesService.create(dto, actor);
  }

  @Get()
  findAll(@CurrentUser() actor: CurrentUserPayload) {
    return this.shiftTypesService.findAll(actor);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.shiftTypesService.findOne(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateShiftTypeDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.shiftTypesService.update(id, dto, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.shiftTypesService.remove(id, actor);
  }
}
