import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue, IssueListQuery, Label } from "@workflo/shared";
import { api } from "../../lib/api.js";

export type IssueListResult = {
  items: Issue[];
  nextCursor: string | null;
};

/** Filters accepted by the backlog list view — a subset of IssueListQuery that omits `cursor` (handled internally by the hook). */
export type BacklogFilters = {
  status?: IssueListQuery["status"];
  assigneeId?: string;
  labelId?: string;
  q?: string;
};

const BACKLOG_LIMIT = 50;

export function backlogQueryKey(projectId: string, filters: BacklogFilters) {
  return [
    "issues",
    "backlog",
    projectId,
    filters.status ?? null,
    filters.assigneeId ?? null,
    filters.labelId ?? null,
    filters.q ?? null,
  ] as const;
}

function buildQueryString(filters: BacklogFilters, cursor: string | null): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
  if (filters.labelId) params.set("labelId", filters.labelId);
  if (filters.q) params.set("q", filters.q);
  params.set("limit", String(BACKLOG_LIMIT));
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/**
 * Filtered + cursor-paginated issue list for the backlog view. Unlike the
 * board's `useProjectIssues` (which loads up to 100 issues once and lets the
 * client group/sort them), this hook mirrors the API's own pagination: it
 * caches only the pages fetched so far and exposes `fetchNextPage`-style
 * "load more" via `loadMore`, appending `items` and following `nextCursor`.
 *
 * Filter changes (status/assigneeId/labelId/q) produce a different cache key
 * (see backlogQueryKey) so switching filters starts a fresh first page
 * instead of appending onto stale results.
 */
export function useProjectIssuesFiltered(projectId: string, filters: BacklogFilters) {
  const queryClient = useQueryClient();
  const queryKey = backlogQueryKey(projectId, filters);

  const query = useQuery({
    queryKey,
    queryFn: () => api.get<IssueListResult>(`/projects/${projectId}/issues?${buildQueryString(filters, null)}`),
  });

  const nextCursor = query.data?.nextCursor ?? null;
  const isFetching = query.isFetching;

  async function loadMore(): Promise<void> {
    if (!nextCursor || isFetching) return;
    const page = await api.get<IssueListResult>(
      `/projects/${projectId}/issues?${buildQueryString(filters, nextCursor)}`,
    );
    queryClient.setQueryData<IssueListResult>(queryKey, (old) => {
      if (!old) return page;
      return { items: [...old.items, ...page.items], nextCursor: page.nextCursor };
    });
  }

  return { ...query, loadMore };
}

export function projectLabelsQueryKey(projectId: string) {
  return ["labels", projectId] as const;
}

export function useProjectLabels(projectId: string) {
  return useQuery({
    queryKey: projectLabelsQueryKey(projectId),
    queryFn: () => api.get<Label[]>(`/projects/${projectId}/labels`),
  });
}
