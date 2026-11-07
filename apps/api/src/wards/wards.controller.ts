import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { WardsService } from './wards.service';
import { CreateWardDto } from './dto/create-ward.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

@Controller('wards')
export class WardsController {
  constructor(private readonly wardsService: WardsService) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post()
  create(@Body() dto: CreateWardDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.wardsService.create(dto, actor);
  }

  @Get()
  findAll(@CurrentUser() actor: CurrentUserPayload) {
    return this.wardsService.findAll(actor);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.wardsService.findOne(id, actor);
  }
}
