import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { REALTIME_EVENTS, type Notification } from "@workflo/shared";
import { getSocket } from "../../lib/socket.js";
import {
  notificationsListQueryKey,
  unreadCountQueryKey,
  type NotificationListResult,
} from "./notification.queries.js";

/**
 * Wires the notification bell to the real-time gateway. The gateway already
 * auto-joins every authenticated socket to its own `user:{id}` room on connect
 * (no explicit join needed — a user's own notifications are always theirs), so
 * here we only listen:
 *
 * - `notification.created` (the bare Notification row, same "payload = what's
 *   emitted" discipline as the issue/comment events): bump the unread-count
 *   cache by +1, and if the list cache is populated (panel has been opened at
 *   least once this session), prepend the new row to page 1 idempotently.
 *   The badge is ALWAYS driven by the server-backed unread-count query, never
 *   derived from the loaded list.
 * - On RECONNECT (not the initial connect) we can't know what we missed while
 *   offline, so we invalidate both the unread-count and list queries rather
 *   than trying to replay events — mirrors useBoardRealtime.
 *
 * `onArrival` lets the mounting component (NotificationBell) react to a live
 * arrival while the panel is open (e.g. shift an active keyboard highlight so a
 * prepend never steals the target). Called AFTER the caches are updated.
 */
export function useNotificationsRealtime(onArrival?: (notification: Notification) => void): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = getSocket();
    const hasConnectedBefore = { current: false };

    function handleConnect() {
      if (hasConnectedBefore.current) {
        void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
        void queryClient.invalidateQueries({ queryKey: notificationsListQueryKey });
      }
      hasConnectedBefore.current = true;
    }

    function handleNotificationCreated(incoming: Notification) {
      // Bump the unread-count badge (source of truth for the number).
      queryClient.setQueryData<{ count: number }>(unreadCountQueryKey, (old) =>
        old ? { count: old.count + 1 } : old,
      );

      // Prepend to page 1 only if the list cache exists; otherwise nothing
      // (the next panel open will fetch a fresh first page including this row).
      queryClient.setQueryData<NotificationListResult>(notificationsListQueryKey, (old) => {
        if (!old) return old;
        if (old.items.some((n) => n.id === incoming.id)) return old; // idempotent
        return { ...old, items: [incoming, ...old.items] };
      });

      onArrival?.(incoming);
    }

    socket.on("connect", handleConnect);
    socket.on(REALTIME_EVENTS.NOTIFICATION_CREATED, handleNotificationCreated);

    if (socket.connected) {
      hasConnectedBefore.current = true;
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off(REALTIME_EVENTS.NOTIFICATION_CREATED, handleNotificationCreated);
    };
  }, [queryClient, onArrival]);
}
