import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Notification, NotificationListQuery, NotificationPayload } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";

type NotificationRow = {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
};

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as Notification["type"],
    payload: row.payload as NotificationPayload,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

export interface NotificationListResult {
  items: Notification[];
  nextCursor: string | null;
}

/**
 * User-scoped notifications read/write API — every method takes the CURRENT
 * user's id and only ever touches THAT user's rows (no workspace guard is
 * needed here, unlike Issues/Comments: a notification belongs to exactly one
 * user, and JwtAuthGuard alone is the correct authz boundary). Rows
 * themselves are created only by `NotificationsProcessor` (the BullMQ
 * worker) — this service never inserts.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest-first, cursor-paginated list of the caller's own notifications. */
  async listForUser(userId: string, query: NotificationListQuery): Promise<NotificationListResult> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    return { items: items.map(toNotification), nextCursor };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /** Marks a single notification read. 404 if it doesn't exist at all; 403 if it exists but belongs to another user. */
  async markRead(id: string, userId: string): Promise<Notification> {
    const existing = await this.prisma.notification.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException("Notification not found");
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException("Cannot read another user's notification");
    }

    const row = await this.prisma.notification.update({
      where: { id },
      data: { readAt: existing.readAt ?? new Date() },
    });
    return toNotification(row);
  }

  /** Marks every currently-unread notification of the caller's as read. Returns the count updated. */
  async markAllRead(userId: string): Promise<{ count: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: result.count };
  }
}
