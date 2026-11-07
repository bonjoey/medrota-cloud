import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { DepartmentsService } from './departments.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-A04: จัดการข้อมูลแผนก */
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post()
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.departmentsService.create(dto, actor);
  }

  @Get()
  findAll(@CurrentUser() actor: CurrentUserPayload) {
    return this.departmentsService.findAll(actor);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.departmentsService.findOne(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.departmentsService.update(id, dto, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.departmentsService.remove(id, actor);
  }
}
