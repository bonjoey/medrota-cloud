import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUserPayload } from '../common/decorators/current-user.decorator';

/**
 * FR-U08 (Must Have): รับการแจ้งเตือน — เดิมหลายโมดูล (leaves, shift-swaps, ...)
 * เขียนลง `Notification` ไว้แล้วตั้งแต่ MVP 3 Sprint 9 แต่ไม่มีช่องทางให้ผู้ใช้ "เห็น"
 * เลย (ไม่มี Controller/Endpoint อ่านของตนเองได้) — โมดูลนี้ปิดช่องว่างนั้น
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(actor: CurrentUserPayload, query: { unreadOnly?: boolean; limit?: number }) {
    return this.prisma.notification.findMany({
      where: { userId: actor.userId, ...(query.unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 50, 100),
    });
  }

  unreadCount(actor: CurrentUserPayload) {
    return this.prisma.notification.count({ where: { userId: actor.userId, isRead: false } });
  }

  async markRead(id: string, actor: CurrentUserPayload) {
    const notification = await this.prisma.notification.findUnique({ where: { id } });
    if (!notification) throw new NotFoundException('ไม่พบการแจ้งเตือน');
    if (notification.userId !== actor.userId) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงการแจ้งเตือนนี้');
    }
    if (notification.isRead) return notification;
    return this.prisma.notification.update({ where: { id }, data: { isRead: true } });
  }

  async markAllRead(actor: CurrentUserPayload) {
    const result = await this.prisma.notification.updateMany({
      where: { userId: actor.userId, isRead: false },
      data: { isRead: true },
    });
    return { updated: result.count };
  }
}
