import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TriageResponse, TriageSectionKey } from "@workflo/shared";
import { api } from "../../lib/api.js";

export function triageQueryKey(workspaceId: string | null) {
  return ["triage", workspaceId] as const;
}

/**
 * `GET /triage?workspaceId&tz` — the caller's local UTC offset in MINUTES
 * (matches `/query/execute`'s `tz` convention). `staleTime: 60_000` mirrors
 * the server's own 60s Redis cache (docs/design/nlq-search.md §2.7/§3.4) —
 * no point refetching more often than the server would recompute anyway.
 */
export function useTriage(workspaceId: string | null) {
  return useQuery({
    queryKey: triageQueryKey(workspaceId),
    queryFn: () => {
      const tz = -new Date().getTimezoneOffset();
      return api.get<TriageResponse>(`/triage?workspaceId=${workspaceId}&tz=${tz}`);
    },
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

export function useDismissTriage(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, section }: { issueId: string; section: TriageSectionKey }) =>
      api.post<{ ok: true }>("/triage/dismiss", { issueId, section }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: triageQueryKey(workspaceId) });
    },
  });
}

export function useMarkTriageSeen(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/triage/seen", { workspaceId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: triageQueryKey(workspaceId) });
    },
  });
}
