import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateIssue, Issue, IssueStatus, MoveIssue } from "@workflo/shared";
import { api } from "../../lib/api.js";

export type IssueListResult = {
  items: Issue[];
  nextCursor: string | null;
};

export function issuesQueryKey(projectId: string) {
  return ["issues", projectId] as const;
}

export function useProjectIssues(projectId: string) {
  return useQuery({
    queryKey: issuesQueryKey(projectId),
    queryFn: () => api.get<IssueListResult>(`/projects/${projectId}/issues?limit=100`),
  });
}

export function useCreateIssue(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIssue) => api.post<Issue>(`/projects/${projectId}/issues`, input),
    onSuccess: (created) => {
      queryClient.setQueryData<IssueListResult>(issuesQueryKey(projectId), (old) => {
        if (!old) return { items: [created], nextCursor: null };
        return { ...old, items: [...old.items, created] };
      });
    },
  });
}

type MoveIssueInput = {
  issueKey: string;
  body: MoveIssue;
};

/**
 * Server-authoritative move. Callers optimistically patch the cache
 * themselves (via queryClient.setQueryData) before calling this, and roll
 * back on error — this hook only performs the network call + reconciles
 * the cache with the server's response (source of truth for `rank`).
 */
export function useMoveIssue(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ issueKey, body }: MoveIssueInput) => api.post<Issue>(`/issues/${issueKey}/move`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<IssueListResult>(issuesQueryKey(projectId), (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((issue) => (issue.id === updated.id ? updated : issue)),
        };
      });
    },
  });
}

export function groupByStatus(issues: Issue[]): Record<IssueStatus, Issue[]> {
  const groups: Record<IssueStatus, Issue[]> = { TODO: [], IN_PROGRESS: [], DONE: [] };
  for (const issue of issues) {
    groups[issue.status].push(issue);
  }
  for (const status of Object.keys(groups) as IssueStatus[]) {
    groups[status].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  }
  return groups;
}
