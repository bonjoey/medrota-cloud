import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { CurrentUser, CurrentUserPayload } from '../common/decorators/current-user.decorator';

/** FR-U08: ไม่มี @Roles() เพราะทุก Role ต้องดูการแจ้งเตือนของตนเองได้เหมือนกัน */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('unread-count')
  unreadCount(@CurrentUser() actor: CurrentUserPayload) {
    return this.notificationsService.unreadCount(actor);
  }

  @Get()
  findAll(
    @Query('unreadOnly') unreadOnly: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() actor: CurrentUserPayload,
  ) {
    return this.notificationsService.findAll(actor, {
      unreadOnly: unreadOnly === 'true',
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() actor: CurrentUserPayload) {
    return this.notificationsService.markAllRead(actor);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @CurrentUser() actor: CurrentUserPayload) {
    return this.notificationsService.markRead(id, actor);
  }
}
