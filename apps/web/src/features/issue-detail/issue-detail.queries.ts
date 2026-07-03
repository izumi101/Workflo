import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue, Project, UpdateIssue, WorkspaceMember } from "@workflo/shared";
import { api } from "../../lib/api.js";
import { issuesQueryKey } from "../board/board.queries.js";
import type { IssueListResult } from "../board/board.queries.js";

export function issueQueryKey(issueKey: string) {
  return ["issue", issueKey] as const;
}

export function projectQueryKey(projectId: string) {
  return ["project", projectId] as const;
}

export function membersQueryKey(workspaceId: string) {
  return ["members", workspaceId] as const;
}

export function useIssue(issueKey: string) {
  return useQuery({
    queryKey: issueQueryKey(issueKey),
    queryFn: () => api.get<Issue>(`/issues/${issueKey}`),
    enabled: Boolean(issueKey),
  });
}

export function useProject(projectId: string | undefined) {
  return useQuery({
    queryKey: projectQueryKey(projectId ?? ""),
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
}

export function useWorkspaceMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: membersQueryKey(workspaceId ?? ""),
    queryFn: () => api.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
    enabled: Boolean(workspaceId),
  });
}

/**
 * PATCH /issues/:key. On success, writes the server response into the
 * useIssue(key) cache AND last-writer-wins-patches the board's issues cache
 * (issuesQueryKey) if that query happens to be populated, so a board view
 * navigated away from stays consistent without a refetch.
 */
export function useUpdateIssue(issueKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateIssue) => api.patch<Issue>(`/issues/${issueKey}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<Issue>(issueQueryKey(issueKey), updated);
      queryClient.setQueryData<IssueListResult>(issuesQueryKey(updated.projectId), (old) => {
        if (!old) return old;
        const existing = old.items.find((i) => i.id === updated.id);
        if (existing && new Date(updated.updatedAt).getTime() <= new Date(existing.updatedAt).getTime()) {
          return old;
        }
        return {
          ...old,
          items: old.items.map((i) => (i.id === updated.id ? updated : i)),
        };
      });
    },
  });
}
