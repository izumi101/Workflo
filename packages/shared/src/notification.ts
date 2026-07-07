import { z } from "zod";

/**
 * Notification schema — mirrors the `Notification` Prisma model
 * (docs/architecture.md §3). Rows are created ONLY by the BullMQ notification
 * worker (see apps/api/src/notifications/notifications.processor.ts), never
 * inline by the producing services (comments/issues) — producers just
 * enqueue jobs. `type` is a plain string on the Prisma model; the API only
 * ever writes `MENTION`/`ASSIGNED` today (STATUS_CHANGE is a documented
 * future value, not implemented yet).
 */
export const notificationTypeSchema = z.enum(["MENTION", "ASSIGNED"]);
export type NotificationType = z.infer<typeof notificationTypeSchema>;

/** Contextual payload stored on the Notification row — shape depends on `type`, always carries enough to deep-link + render without another lookup. */
export const notificationPayloadSchema = z.object({
  issueKey: z.string(),
  projectId: z.string().cuid(),
  actorId: z.string().cuid(),
  actorName: z.string(),
  title: z.string().optional(),
  snippet: z.string().optional(),
  commentId: z.string().cuid().optional(),
});
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export const notificationSchema = z.object({
  id: z.string().cuid(),
  userId: z.string().cuid(),
  type: notificationTypeSchema,
  payload: notificationPayloadSchema,
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const unreadCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;
