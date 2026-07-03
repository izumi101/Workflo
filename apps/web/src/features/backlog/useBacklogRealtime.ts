import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { REALTIME_CLIENT_EVENTS, REALTIME_EVENTS, type Issue, type IssueDeletedEventPayload } from "@workflo/shared";
import { getSocket } from "../../lib/socket.js";

/**
 * Wires the backlog list view to the real-time gateway (mirrors
 * useBoardRealtime.ts / useIssueDetailRealtime.ts — joins the same
 * `project:{projectId}` room, there is no per-view room).
 *
 * Unlike the board, the backlog query is filtered AND cursor-paginated, so
 * there is no single well-defined place to splice an incoming
 * create/update/move event into `items` (it might belong on a page we
 * haven't fetched, might no longer match the active filters, etc). Rather
 * than attempt a filter-aware upsert, this hook takes the simple, correct
 * path: invalidate every cached backlog query for this project on
 * issue.created/updated/moved/deleted, which triggers a refetch of whatever
 * filtered page(s) are currently mounted. Also invalidates on reconnect
 * (we can't know what we missed while offline).
 */
export function useBacklogRealtime(projectId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    const socket = getSocket();
    const hasConnectedBefore = { current: false };

    function invalidateBacklog() {
      void queryClient.invalidateQueries({ queryKey: ["issues", "backlog", projectId] });
    }

    function joinProject() {
      socket.emit(REALTIME_CLIENT_EVENTS.JOIN_PROJECT, { projectId });
    }

    function handleConnect() {
      if (hasConnectedBefore.current) {
        invalidateBacklog();
      }
      hasConnectedBefore.current = true;
      joinProject();
    }

    function handleIssueUpsert(incoming: Issue) {
      if (incoming.projectId !== projectId) return;
      invalidateBacklog();
    }

    function handleIssueDeleted(payload: IssueDeletedEventPayload) {
      if (payload.projectId !== projectId) return;
      invalidateBacklog();
    }

    socket.on("connect", handleConnect);
    socket.on(REALTIME_EVENTS.ISSUE_CREATED, handleIssueUpsert);
    socket.on(REALTIME_EVENTS.ISSUE_UPDATED, handleIssueUpsert);
    socket.on(REALTIME_EVENTS.ISSUE_MOVED, handleIssueUpsert);
    socket.on(REALTIME_EVENTS.ISSUE_DELETED, handleIssueDeleted);

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
    };
  }, [projectId, queryClient]);
}
