import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  notificationListQuerySchema,
  type AuthUser,
  type Notification,
  type NotificationListQuery,
} from "@workflo/shared";
import { NotificationsService, type NotificationListResult } from "./notifications.service.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { ZodQueryValidationPipe } from "../auth/zod-validation.pipe.js";

/**
 * User-scoped notifications API — no WorkspaceMemberGuard here (unlike
 * Issues/Comments): a notification belongs to exactly one user, so
 * JwtAuthGuard + always reading `user.id` off the token is the entire authz
 * boundary. Every route only ever looks at/mutates the CALLER's own rows.
 */
@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodQueryValidationPipe(notificationListQuerySchema)) query: NotificationListQuery,
  ): Promise<NotificationListResult> {
    return this.notificationsService.listForUser(user.id, query);
  }

  @Get("unread-count")
  async unreadCount(@CurrentUser() user: AuthUser): Promise<{ count: number }> {
    const count = await this.notificationsService.unreadCount(user.id);
    return { count };
  }

  @Post(":id/read")
  async markRead(@Param("id") id: string, @CurrentUser() user: AuthUser): Promise<Notification> {
    return this.notificationsService.markRead(id, user.id);
  }

  @Post("read-all")
  async markAllRead(@CurrentUser() user: AuthUser): Promise<{ count: number }> {
    return this.notificationsService.markAllRead(user.id);
  }
}
