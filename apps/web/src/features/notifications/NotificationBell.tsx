import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Notification } from "@workflo/shared";
import { api } from "../../lib/api.js";
import { formatRelativeTime } from "../../lib/relativeTime.js";
import { useAuthStore } from "../../store/auth.store.js";
import {
  notificationsListQueryKey,
  unreadCountQueryKey,
  useNotificationsList,
  useUnreadCount,
  type NotificationListResult,
} from "./notification.queries.js";
import { useNotificationsRealtime } from "./useNotificationsRealtime.js";

/** Line-1 sentence for a notification row (verb differs by type; the actor + verb + key part truncates, the time never wraps). */
function NotificationRowContent({ notification }: { notification: Notification }) {
  const { type, payload } = notification;
  return (
    <>
      <div className="notif-row__line">
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
            color: "#9aa0a6",
          }}
        >
          <span className="notif-row__actor">{payload.actorName}</span>{" "}
          {type === "MENTION" ? "mentioned you in " : "assigned "}
          <span className="notif-row__key">{payload.issueKey}</span>
          {type === "ASSIGNED" ? " to you" : ""}
        </span>
        <span className="notif-row__time">{formatRelativeTime(notification.createdAt)}</span>
      </div>
      {type === "MENTION" && payload.snippet ? <p className="notif-row__snippet">{payload.snippet}</p> : null}
    </>
  );
}

export function NotificationBell() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  const { data: unreadData } = useUnreadCount();
  const unreadCount = unreadData?.count ?? 0;

  const {
    data: listData,
    isPending: listPending,
    isError: listError,
    isFetching: listFetching,
    loadMore,
    refetch: refetchList,
  } = useNotificationsList(isOpen);

  const items = listData?.items ?? [];

  // Live arrival while the panel is open: if a keyboard highlight is active,
  // shift it +1 so the prepended row never steals the target (spec §4).
  const handleArrival = useCallback(() => {
    setHighlightedIndex((prev) => (prev >= 0 ? prev + 1 : prev));
  }, []);
  useNotificationsRealtime(handleArrival);

  // Close on outside mousedown (mirror GlobalSearch).
  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  // Reset the keyboard highlight whenever the panel opens/closes.
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [isOpen]);

  if (!user) {
    return null;
  }

  function markReadOptimistic(id: string) {
    const now = new Date();
    queryClient.setQueryData<NotificationListResult>(notificationsListQueryKey, (old) => {
      if (!old) return old;
      return {
        ...old,
        items: old.items.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: now } : n)),
      };
    });
    queryClient.setQueryData<{ count: number }>(unreadCountQueryKey, (old) =>
      old ? { count: Math.max(0, old.count - 1) } : old,
    );
  }

  function reconcileOnFailure() {
    void queryClient.invalidateQueries({ queryKey: notificationsListQueryKey });
    void queryClient.invalidateQueries({ queryKey: unreadCountQueryKey });
  }

  function activateRow(notification: Notification) {
    if (!notification.readAt) {
      markReadOptimistic(notification.id);
      // Fire-and-forget; on failure silently reconcile, never block navigation.
      void api.post(`/notifications/${notification.id}/read`).catch(reconcileOnFailure);
    }
    navigate(`/issues/${notification.payload.issueKey}`);
    setIsOpen(false);
  }

  function markAllRead() {
    const now = new Date();
    queryClient.setQueryData<NotificationListResult>(notificationsListQueryKey, (old) => {
      if (!old) return old;
      return { ...old, items: old.items.map((n) => (n.readAt ? n : { ...n, readAt: now })) };
    });
    queryClient.setQueryData<{ count: number }>(unreadCountQueryKey, () => ({ count: 0 }));
    void api.post("/notifications/read-all").catch(reconcileOnFailure);
    // Panel stays open (spec §4).
  }

  function handleBellKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (isOpen && highlightedIndex >= 0) {
        const notification = items[highlightedIndex];
        if (notification) {
          activateRow(notification);
          return;
        }
      }
      setIsOpen((prev) => !prev);
    } else if (e.key === "Escape") {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (items.length === 0) return;
      setHighlightedIndex((prev) => (prev + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen || items.length === 0) return;
      setHighlightedIndex((prev) => (prev - 1 + items.length) % items.length);
    }
  }

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);
  const nextCursor = listData?.nextCursor ?? null;

  return (
    <div className="notif-bell-wrapper" ref={wrapperRef}>
      <button
        ref={bellRef}
        type="button"
        className="notif-bell"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleBellKeyDown}
        aria-label={`Notifications, ${unreadCount} unread`}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls="notif-panel"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 6.5a4.5 4.5 0 0 0-9 0c0 5-2 6-2 6h13s-2-1-2-6" />
          <path d="M9.3 15.5a1.6 1.6 0 0 0 2.8 0" />
        </svg>
        {unreadCount > 0 ? <span className="notif-bell__badge">{badgeLabel}</span> : null}
      </button>

      {isOpen ? (
        <div className="notif-panel" id="notif-panel" role="listbox">
          <div className="notif-panel__header">
            <span className="notif-panel__title">Notifications</span>
            {unreadCount > 0 ? (
              <button type="button" className="notif-panel__mark-all" onClick={markAllRead}>
                Mark all read
              </button>
            ) : null}
          </div>

          <ul className="notif-panel__list">
            {listPending ? (
              <li className="notif-panel__status">Loading…</li>
            ) : listError ? (
              <li className="notif-panel__status">
                Couldn&apos;t load notifications.{" "}
                <button type="button" className="notif-panel__mark-all" onClick={() => void refetchList()}>
                  Retry
                </button>
              </li>
            ) : items.length === 0 ? (
              <li className="notif-panel__status">
                <span style={{ color: "#9aa0a6" }}>No notifications yet</span>
                <span style={{ display: "block", fontSize: "0.78rem", color: "#6b7280" }}>
                  Mentions and assignments will show up here.
                </span>
              </li>
            ) : (
              items.map((notification, index) => {
                const isRead = Boolean(notification.readAt);
                const classes = ["notif-row"];
                if (index === highlightedIndex) classes.push("notif-row--active");
                if (isRead) classes.push("notif-row--read");
                return (
                  <li key={notification.id} role="option" aria-selected={index === highlightedIndex}>
                    <button
                      type="button"
                      className={classes.join(" ")}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => activateRow(notification)}
                    >
                      <span className="notif-row__dot" />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <NotificationRowContent notification={notification} />
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {nextCursor ? (
            <button
              type="button"
              className="notif-panel__load-more"
              onClick={() => void loadMore()}
              disabled={listFetching}
            >
              {listFetching ? "Loading…" : "Load more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
