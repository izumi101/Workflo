import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { NotificationsProcessor } from "./notifications.processor.js";
import { NotificationsQueueModule } from "./notifications-queue.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";

/**
 * Owns the notifications REST API (user-scoped read/mark-read) and the
 * in-process BullMQ worker that turns enqueued mention/assign jobs into
 * `Notification` rows + a live `notification.created` push (via
 * RealtimeModule's gateway — see NotificationsProcessor). Producers
 * (CommentsModule, IssuesModule) only need NotificationsQueueModule to
 * enqueue jobs; they do NOT depend on this module.
 */
@Module({
  imports: [NotificationsQueueModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
