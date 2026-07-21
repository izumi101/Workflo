import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Label, Project } from "@workflo/shared";
import { api } from "../../lib/api.js";
import { useWorkspaceMembers } from "../issue-detail/issue-detail.queries.js";
import type { Directory } from "./types.js";

export function projectsQueryKey(workspaceId: string) {
  return ["projects", workspaceId] as const;
}

export function useWorkspaceProjects(workspaceId: string | null) {
  return useQuery({
    queryKey: projectsQueryKey(workspaceId ?? ""),
    queryFn: () => api.get<Project[]>(`/projects?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });
}

/**
 * Labels are scoped per-project (no workspace-wide labels endpoint exists —
 * see `packages/shared/src/label.ts`). Loading the whole workspace's labels
 * for entity resolution therefore means one call per project; kept simple
 * per the brief ("if that needs N calls keep it simple/cached") via
 * `useQueries` (parallel, each cached independently at the existing
 * `["labels", projectId]` key already used by the backlog view, so this
 * shares cache with `useProjectLabels`).
 */
export function useWorkspaceLabels(projects: Project[] | undefined) {
  const list = projects ?? [];
  const results = useQueries({
    queries: list.map((p) => ({
      queryKey: ["labels", p.id] as const,
      queryFn: () => api.get<Label[]>(`/projects/${p.id}/labels`),
      staleTime: 60_000,
    })),
  });

  const labels = useMemo(() => results.flatMap((r) => r.data ?? []), [results]);
  const isLoading = results.some((r) => r.isLoading);
  return { labels, isLoading };
}

/** Bundles members/projects/labels into the `Directory` the resolver + chip formatter need. */
export function useCommandBarDirectory(workspaceId: string | null): { directory: Directory; isLoading: boolean } {
  const { data: members, isLoading: membersLoading } = useWorkspaceMembers(workspaceId ?? undefined);
  const { data: projects, isLoading: projectsLoading } = useWorkspaceProjects(workspaceId);
  const { labels, isLoading: labelsLoading } = useWorkspaceLabels(projects);

  const directory = useMemo<Directory>(
    () => ({ members: members ?? [], projects: projects ?? [], labels }),
    [members, projects, labels],
  );

  return { directory, isLoading: membersLoading || projectsLoading || labelsLoading };
}
