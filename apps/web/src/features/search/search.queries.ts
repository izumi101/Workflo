import { useQuery } from "@tanstack/react-query";
import type { SearchResult } from "@workflo/shared";
import { api } from "../../lib/api.js";

const SEARCH_LIMIT = 10;

export function searchQueryKey(workspaceId: string, q: string) {
  return ["search", workspaceId, q] as const;
}

/**
 * Global search across all projects in a workspace (GET /api/v1/search).
 * Skips the request entirely for a blank/whitespace query — a search box
 * should show nothing, not "everything", before the user types.
 */
export function useGlobalSearch(workspaceId: string | null, q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: searchQueryKey(workspaceId ?? "", trimmed),
    queryFn: () =>
      api.get<{ items: SearchResult[] }>(
        `/search?q=${encodeURIComponent(trimmed)}&workspaceId=${workspaceId}&limit=${SEARCH_LIMIT}`,
      ),
    enabled: Boolean(workspaceId) && trimmed.length > 0,
    staleTime: 10_000,
  });
}
