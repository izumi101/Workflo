import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { REALTIME_EVENTS, userRoom, type Notification, type NotificationPayload } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeGateway } from "../realtime/realtime.gateway.js";
import { NOTIFICATIONS_QUEUE, type NotificationJobData } from "./notification-job.js";

function toNotification(row: {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  readAt: Date | null;
  createdAt: Date;
}): Notification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as Notification["type"],
    payload: row.payload as NotificationPayload,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/**
 * In-process BullMQ worker for the `notifications` queue (no separate
 * deployable — runs inside this same Nest app, see CLAUDE.md §8). Consumes
 * jobs enqueued by CommentsService (mention) / IssuesService (assign) AFTER
 * their DB write commits, creates the `Notification` row, then pushes
 * `notification.created` live to the target user's own room (`user:{id}`,
 * NOT a project room — this is the one realtime event that isn't
 * project-scoped) so the notification bell/badge can update without a poll.
 */
@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const data = job.data;

    const actor = await this.prisma.user.findUnique({
      where: { id: data.actorId },
      select: { name: true },
    });

    const payload: NotificationPayload = {
      issueKey: data.issueKey,
      projectId: data.projectId,
      actorId: data.actorId,
      actorName: actor?.name ?? "Someone",
      ...(data.snippet ? { snippet: data.snippet } : {}),
      ...(data.commentId ? { commentId: data.commentId } : {}),
    };

    const row = await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        payload,
      },
    });

    const dto = toNotification(row);
    this.logger.debug(`Created ${data.type} notification ${dto.id} for user ${data.userId}`);
    this.gateway.server.to(userRoom(data.userId)).emit(REALTIME_EVENTS.NOTIFICATION_CREATED, dto);
  }
}
