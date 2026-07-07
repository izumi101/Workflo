import type { NotificationType } from "@workflo/shared";

export const NOTIFICATIONS_QUEUE = "notifications";

/** BullMQ job names — one per notification-producing event. */
export const NOTIFICATION_JOBS = {
  MENTION: "mention",
  ASSIGNED: "assigned",
} as const;

/**
 * Job payload enqueued by producers (CommentsService/IssuesService). The
 * worker (`NotificationsProcessor`) is the ONLY thing that turns this into a
 * `Notification` row — producers never write the row inline, matching the
 * "enqueue after commit, worker owns the side effect" discipline already used
 * for realtime events.
 */
export interface NotificationJobData {
  userId: string;
  type: NotificationType;
  actorId: string;
  issueKey: string;
  projectId: string;
  commentId?: string;
  snippet?: string;
}
