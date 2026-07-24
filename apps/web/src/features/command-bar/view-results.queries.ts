import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryExecuteResponse, WorkfloQuery } from "@workflo/shared";
import { api } from "../../lib/api.js";

const PAGE_LIMIT = 25;

/**
 * Cursor-paginated `/query/execute` for the full results page (§2.5's
 * "generalized BacklogPage"). Mirrors `useProjectIssuesFiltered`
 * (features/backlog/backlog.queries.ts) — cache keyed on the AST so editing
 * a chip (which produces a new `ast` value) starts a fresh first page
 * instead of appending onto stale results, with an explicit `loadMore`
 * instead of infinite scroll, same as the rest of the app's list views.
 * `/query/execute` is POST (the AST is a request body, not query params),
 * so this can't reuse `useQuery`'s GET-based key-as-URL convention directly
 * — the AST's JSON serialization IS the cache key instead.
 */
export function useQueryExecutePaged(workspaceId: string | null, ast: WorkfloQuery) {
  const queryClient = useQueryClient();
  const astKey = JSON.stringify(ast);
  const queryKey = ["query-execute", workspaceId ?? "", astKey] as const;
  const tz = -new Date().getTimezoneOffset();

  const query = useQuery({
    queryKey,
    queryFn: () =>
      api.post<QueryExecuteResponse>("/query/execute", { workspaceId, ast, limit: PAGE_LIMIT, tz }),
    enabled: Boolean(workspaceId),
  });

  const nextCursor = query.data?.nextCursor ?? null;
  const isFetching = query.isFetching;

  async function loadMore(): Promise<void> {
    if (!nextCursor || isFetching) return;
    const page = await api.post<QueryExecuteResponse>("/query/execute", {
      workspaceId,
      ast,
      cursor: nextCursor,
      limit: PAGE_LIMIT,
      tz,
    });
    queryClient.setQueryData<QueryExecuteResponse>(queryKey, (old) => {
      if (!old) return page;
      return { items: [...old.items, ...page.items], nextCursor: page.nextCursor };
    });
  }

  return { ...query, loadMore };
}
