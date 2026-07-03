import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateProject, CreateWorkspace, Project, Workspace } from "@workflo/shared";
import { api } from "./api.js";

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.get<Workspace[]>("/workspaces"),
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkspace) => api.post<Workspace>("/workspaces", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useProjects(workspaceId: string | null) {
  return useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: () => api.get<Project[]>(`/projects?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProject) => api.post<Project>("/projects", input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["projects", variables.workspaceId] });
    },
  });
}
