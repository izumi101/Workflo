import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateView, UpdateView, View } from "@workflo/shared";
import { api } from "../../lib/api.js";

export function viewsQueryKey(workspaceId: string | null) {
  return ["views", workspaceId] as const;
}

export function useViews(workspaceId: string | null) {
  return useQuery({
    queryKey: viewsQueryKey(workspaceId),
    queryFn: () => api.get<View[]>(`/views?workspaceId=${workspaceId}`),
    enabled: Boolean(workspaceId),
  });
}

export function useCreateView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateView) => api.post<View>("/views", input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: viewsQueryKey(variables.workspaceId) });
    },
  });
}

/** `workspaceId` is passed in so invalidation targets the right `["views", workspaceId]` cache key (PATCH/DELETE only know the view id, not its workspace, without it). */
export function useUpdateView(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateView & { id: string }) => api.patch<View>(`/views/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: viewsQueryKey(workspaceId) });
    },
  });
}

export function useDeleteView(workspaceId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<View>(`/views/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: viewsQueryKey(workspaceId) });
    },
  });
}
