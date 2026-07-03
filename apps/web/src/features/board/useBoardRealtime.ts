import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_EVENTS,
  type Issue,
  type IssueDeletedEventPayload,
  type PresenceUpdatePayload,
} from "@workflo/shared";
import { getSocket } from "../../lib/socket.js";
import { issuesQueryKey } from "./board.queries.js";
import type { IssueListResult } from "./board.queries.js";

/**
 * Wires a project's board to the real-time gateway (ADR-0003):
 *
 * - Joins `project:{projectId}` on mount and on every socket `connect`
 *   (including automatic reconnects), leaves it on unmount.
 * - `issue.created` / `issue.updated` / `issue.moved` are applied as an
 *   idempotent, last-writer-wins-by-`updatedAt` upsert into the
 *   `issuesQueryKey` cache — safe against echoes of our own optimistic
 *   mutations and against duplicate/out-of-order delivery. The server is
 *   the source of truth for `rank`, so a newer event always wins outright.
 *   NOTE: `RealtimeListener.broadcast` (apps/api/src/realtime/realtime.listener.ts)
 *   emits the bare `Issue` object for these three events (`payload.issue`,
 *   not the `{projectId, issue}` wrapper) — confirmed against the real
 *   gateway in the two-socket smoke test. `Issue` itself carries `projectId`,
 *   which is what we filter on.
 * - `issue.deleted` removes the issue by id (this one DOES send the full
 *   `{projectId, issueId}` wrapper — see the listener).
 * - On RECONNECT (not the initial connect) we can't know what we missed
 *   while offline, so we invalidate + refetch the board query instead of
 *   trying to replay events.
 * - `presence.update` is exposed as the returned `onlineUserIds` so the
 *   board header can render a lightweight presence chip.
 */
export function useBoardRealtime(projectId: string): { onlineUserIds: string[] } {
  const queryClient = useQueryClient();
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);

  useEffect(() => {
    const socket = getSocket();
    // Tracks whether we've already completed a first connect for this
    // effect instance — `connect` firing again after that means we
    // dropped and came back, i.e. a reconnect, not the initial join.
    const hasConnectedBefore = { current: false };

    function joinProject() {
      socket.emit(REALTIME_CLIENT_EVENTS.JOIN_PROJECT, { projectId });
    }

    function handleConnect() {
      if (hasConnectedBefore.current) {
        void queryClient.invalidateQueries({ queryKey: issuesQueryKey(projectId) });
      }
      hasConnectedBefore.current = true;
      joinProject();
    }

    function upsertIssue(incoming: Issue) {
      queryClient.setQueryData<IssueListResult>(issuesQueryKey(projectId), (old) => {
        if (!old) return old;
        const existing = old.items.find((i) => i.id === incoming.id);
        if (!existing) {
          return { ...old, items: [...old.items, incoming] };
        }
        // Last-writer-wins by updatedAt: ignore if the cached copy is the
        // same age or newer (handles echoes + out-of-order delivery).
        if (new Date(incoming.updatedAt).getTime() <= new Date(existing.updatedAt).getTime()) {
          return old;
        }
        return {
          ...old,
          items: old.items.map((i) => (i.id === incoming.id ? incoming : i)),
        };
      });
    }

    function handleIssueUpsert(incoming: Issue) {
      if (incoming.projectId !== projectId) return;
      upsertIssue(incoming);
    }

    function handleIssueDeleted(payload: IssueDeletedEventPayload) {
      if (payload.projectId !== projectId) return;
      queryClient.setQueryData<IssueListResult>(issuesQueryKey(projectId), (old) => {
        if (!old) return old;
        return { ...old, items: old.items.filter((i) => i.id !== payload.issueId) };
      });
    }

    function handlePresenceUpdate(payload: PresenceUpdatePayload) {
      if (payload.projectId !== projectId) return;
      setOnlineUserIds(payload.userIds);
    }

    socket.on("connect", handleConnect);
    socket.on(REALTIME_EVENTS.ISSUE_CREATED, handleIssueUpsert);
    socket.on(REALTIME_EVENTS.ISSUE_UPDATED, handleIssueUpsert);
    socket.on(REALTIME_EVENTS.ISSUE_MOVED, handleIssueUpsert);
    socket.on(REALTIME_EVENTS.ISSUE_DELETED, handleIssueDeleted);
    socket.on(REALTIME_EVENTS.PRESENCE_UPDATE, handlePresenceUpdate);

    // Socket may already be connected (e.g. navigating between boards) —
    // in that case `connect` won't fire again, so join explicitly now.
    if (socket.connected) {
      joinProject();
      hasConnectedBefore.current = true;
    }

    return () => {
      socket.emit(REALTIME_CLIENT_EVENTS.LEAVE_PROJECT, { projectId });
      socket.off("connect", handleConnect);
      socket.off(REALTIME_EVENTS.ISSUE_CREATED, handleIssueUpsert);
      socket.off(REALTIME_EVENTS.ISSUE_UPDATED, handleIssueUpsert);
      socket.off(REALTIME_EVENTS.ISSUE_MOVED, handleIssueUpsert);
      socket.off(REALTIME_EVENTS.ISSUE_DELETED, handleIssueDeleted);
      socket.off(REALTIME_EVENTS.PRESENCE_UPDATE, handlePresenceUpdate);
      setOnlineUserIds([]);
    };
  }, [projectId, queryClient]);

  return { onlineUserIds };
}
