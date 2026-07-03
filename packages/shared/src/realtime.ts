import { z } from "zod";
import { issueSchema } from "./issue.js";
import { commentSchema } from "./comment.js";

/**
 * Real-time event names shared between the API (emitter) and web client
 * (listener) — see ADR-0003 and docs/architecture.md §5. Keep this list in
 * sync with what RealtimeListener actually broadcasts.
 */
export const REALTIME_EVENTS = {
  ISSUE_CREATED: "issue.created",
  ISSUE_UPDATED: "issue.updated",
  ISSUE_MOVED: "issue.moved",
  ISSUE_DELETED: "issue.deleted",
  COMMENT_ADDED: "comment.added",
  COMMENT_UPDATED: "comment.updated",
  COMMENT_DELETED: "comment.deleted",
  PRESENCE_UPDATE: "presence.update",
} as const;

export type RealtimeEvent = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/** Client -> server socket events. */
export const REALTIME_CLIENT_EVENTS = {
  JOIN_PROJECT: "joinProject",
  LEAVE_PROJECT: "leaveProject",
} as const;

export const issueEventPayloadSchema = z.object({
  projectId: z.string().cuid(),
  issue: issueSchema,
});
export type IssueEventPayload = z.infer<typeof issueEventPayloadSchema>;

export const issueDeletedEventPayloadSchema = z.object({
  projectId: z.string().cuid(),
  issueId: z.string().cuid(),
});
export type IssueDeletedEventPayload = z.infer<typeof issueDeletedEventPayloadSchema>;

/**
 * Wire shape for `comment.added` / `comment.updated` — the flat comment
 * object extended with the routing fields clients need to file the event
 * under the right issue without a second lookup. This is exactly what
 * RealtimeListener emits; do not drift the two apart (see the issue-events
 * lesson in CLAUDE.md — alignment there is a separate roadmap item, 0.5).
 */
export const commentEventPayloadSchema = commentSchema.extend({
  projectId: z.string().cuid(),
  issueKey: z.string(),
});
export type CommentEventPayload = z.infer<typeof commentEventPayloadSchema>;

export const commentDeletedEventPayloadSchema = z.object({
  projectId: z.string().cuid(),
  issueKey: z.string(),
  commentId: z.string().cuid(),
});
export type CommentDeletedEventPayload = z.infer<typeof commentDeletedEventPayloadSchema>;

export const presenceUpdatePayloadSchema = z.object({
  projectId: z.string().cuid(),
  userIds: z.array(z.string().cuid()),
});
export type PresenceUpdatePayload = z.infer<typeof presenceUpdatePayloadSchema>;

/** Room name helper — keep the naming convention (`project:{id}`) in one place. */
export function projectRoom(projectId: string): string {
  return `project:${projectId}`;
}
