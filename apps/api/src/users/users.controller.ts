import { Body, Controller, Get, Param, Patch, Post, Delete } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-A01, FR-A02: เฉพาะ SuperAdmin และ WardAdmin จัดการผู้ใช้งานได้ */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.usersService.create(dto, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN, Role.HEAD_NURSE)
  @Get()
  findAll(@CurrentUser() actor: CurrentUserPayload) {
    return this.usersService.findAll(actor);
  }

  // ต้องประกาศ 'me' routes ก่อน ':id' เสมอ เพื่อไม่ให้ Nest จับคำว่า "me" เป็น :id
  @Get('me')
  getOwnProfile(@CurrentUser() actor: CurrentUserPayload) {
    return this.usersService.findOne(actor.userId, actor);
  }

  // NFR-02: ผู้ใช้ทุกคนเปลี่ยนรหัสผ่านของตนเองได้
  @Post('me/change-password')
  changeOwnPassword(@Body() dto: ChangePasswordDto, @CurrentUser() actor: CurrentUserPayload) {
    return this.usersService.changeOwnPassword(dto, actor);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.usersService.findOne(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.usersService.update(id, dto, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Delete(':id')
  suspend(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.usersService.suspend(id, actor);
  }

  @Roles(Role.SUPER_ADMIN, Role.WARD_ADMIN)
  @Post(':id/reactivate')
  reactivate(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.usersService.reactivate(id, actor);
  }
}
