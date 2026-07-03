import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_EVENTS,
  type CommentDeletedEventPayload,
  type CommentEventPayload,
  type Issue,
} from "@workflo/shared";
import { getSocket } from "../../lib/socket.js";
import { commentsQueryKey } from "./comment.queries.js";
import type { CommentListResult } from "./comment.queries.js";
import { issueQueryKey } from "./issue-detail.queries.js";

/**
 * Wires the issue detail page to the real-time gateway (mirrors
 * useBoardRealtime.ts). Joins the SAME `project:{projectId}` room the board
 * uses — there is no per-issue room.
 *
 * - `comment.added` / `comment.updated`: filtered to `payload.issueKey ===
 *   issueKey`, then idempotently upserted into the comments cache by id,
 *   last-writer-wins by `updatedAt` (safe against echoes of our own
 *   mutations and duplicate/out-of-order delivery).
 * - `comment.deleted`: filtered the same way, removes by id.
 * - `issue.updated` / `issue.moved` arrive as the BARE `Issue` (known drift,
 *   see realtime.ts + useBoardRealtime.ts) — filtered by `incoming.id`
 *   against the currently loaded issue, then LWW-written into the
 *   useIssue(key) cache so fields edited elsewhere (e.g. from the board)
 *   show up live here too.
 * - On RECONNECT (not the initial connect), invalidate both the issue and
 *   comments queries instead of trying to replay missed events.
 */
export function useIssueDetailRealtime(projectId: string | undefined, issueKey: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId || !issueKey) return;

    const socket = getSocket();
    const hasConnectedBefore = { current: false };

    function joinProject() {
      socket.emit(REALTIME_CLIENT_EVENTS.JOIN_PROJECT, { projectId });
    }

    function handleConnect() {
      if (hasConnectedBefore.current) {
        void queryClient.invalidateQueries({ queryKey: issueQueryKey(issueKey) });
        void queryClient.invalidateQueries({ queryKey: commentsQueryKey(issueKey) });
      }
      hasConnectedBefore.current = true;
      joinProject();
    }

    function handleCommentUpsert(incoming: CommentEventPayload) {
      if (incoming.issueKey !== issueKey) return;
      queryClient.setQueryData<CommentListResult>(commentsQueryKey(issueKey), (old) => {
        if (!old) return old;
        const existing = old.items.find((c) => c.id === incoming.id);
        if (!existing) {
          // comment.added/updated carries the flat comment fields but not
          // the embedded `author` the REST shape has; if we don't already
          // have this comment cached, refetch to get the author summary
          // rather than inserting a partial row.
          void queryClient.invalidateQueries({ queryKey: commentsQueryKey(issueKey) });
          return old;
        }
        if (new Date(incoming.updatedAt).getTime() <= new Date(existing.updatedAt).getTime()) {
          return old;
        }
        return {
          ...old,
          items: old.items.map((c) => (c.id === incoming.id ? { ...c, ...incoming } : c)),
        };
      });
    }

    function handleCommentDeleted(payload: CommentDeletedEventPayload) {
      if (payload.issueKey !== issueKey) return;
      queryClient.setQueryData<CommentListResult>(commentsQueryKey(issueKey), (old) => {
        if (!old) return old;
        return { ...old, items: old.items.filter((c) => c.id !== payload.commentId) };
      });
    }

    function handleIssueUpsert(incoming: Issue) {
      queryClient.setQueryData<Issue>(issueQueryKey(issueKey), (old) => {
        if (!old || old.id !== incoming.id) return old;
        if (new Date(incoming.updatedAt).getTime() <= new Date(old.updatedAt).getTime()) {
          return old;
        }
        return incoming;
      });
    }

    socket.on("connect", handleConnect);
    socket.on(REALTIME_EVENTS.COMMENT_ADDED, handleCommentUpsert);
    socket.on(REALTIME_EVENTS.COMMENT_UPDATED, handleCommentUpsert);
    socket.on(REALTIME_EVENTS.COMMENT_DELETED, handleCommentDeleted);
    socket.on(REALTIME_EVENTS.ISSUE_UPDATED, handleIssueUpsert);
    socket.on(REALTIME_EVENTS.ISSUE_MOVED, handleIssueUpsert);

    if (socket.connected) {
      joinProject();
      hasConnectedBefore.current = true;
    }

    return () => {
      socket.emit(REALTIME_CLIENT_EVENTS.LEAVE_PROJECT, { projectId });
      socket.off("connect", handleConnect);
      socket.off(REALTIME_EVENTS.COMMENT_ADDED, handleCommentUpsert);
      socket.off(REALTIME_EVENTS.COMMENT_UPDATED, handleCommentUpsert);
      socket.off(REALTIME_EVENTS.COMMENT_DELETED, handleCommentDeleted);
      socket.off(REALTIME_EVENTS.ISSUE_UPDATED, handleIssueUpsert);
      socket.off(REALTIME_EVENTS.ISSUE_MOVED, handleIssueUpsert);
    };
  }, [projectId, issueKey, queryClient]);
}
