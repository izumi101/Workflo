import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@workflo/shared";
import { api } from "../../lib/api.js";

export type NotificationListResult = {
  items: Notification[];
  nextCursor: string | null;
};

const NOTIFICATIONS_LIMIT = 20;

/** Query key for the unread-count badge — the single source of truth for the bell's number (never derived from the loaded list, see design spec §6). */
export const unreadCountQueryKey = ["notifications", "unread-count"] as const;

/** Query key for the (single, first-page-refetched-on-open) notification list cache. */
export const notificationsListQueryKey = ["notifications", "list"] as const;

export function useUnreadCount() {
  return useQuery({
    queryKey: unreadCountQueryKey,
    queryFn: () => api.get<{ count: number }>("/notifications/unread-count"),
  });
}

function buildQueryString(cursor: string | null): string {
  const params = new URLSearchParams();
  params.set("limit", String(NOTIFICATIONS_LIMIT));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/**
 * Notification list for the dropdown panel. Per the design spec, opening the
 * panel always starts a fresh first page (no infinite scroll, explicit
 * "Load more" instead) — enabled is controlled by the caller (NotificationBell)
 * so the query doesn't fire while the panel is closed.
 */
export function useNotificationsList(enabled: boolean) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: notificationsListQueryKey,
    queryFn: () => api.get<NotificationListResult>(`/notifications?${buildQueryString(null)}`),
    enabled,
  });

  const nextCursor = query.data?.nextCursor ?? null;
  const isFetching = query.isFetching;

  async function loadMore(): Promise<void> {
    if (!nextCursor || isFetching) return;
    const page = await api.get<NotificationListResult>(`/notifications?${buildQueryString(nextCursor)}`);
    queryClient.setQueryData<NotificationListResult>(notificationsListQueryKey, (old) => {
      if (!old) return page;
      return { items: [...old.items, ...page.items], nextCursor: page.nextCursor };
    });
  }

  return { ...query, loadMore };
}
