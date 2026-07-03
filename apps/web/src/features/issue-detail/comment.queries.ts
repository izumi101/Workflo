import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CommentWithAuthor, CreateComment, UpdateComment } from "@workflo/shared";
import { api } from "../../lib/api.js";

export type CommentListResult = {
  items: CommentWithAuthor[];
  nextCursor: string | null;
};

export function commentsQueryKey(issueKey: string) {
  return ["comments", issueKey] as const;
}

export function useIssueComments(issueKey: string) {
  return useQuery({
    queryKey: commentsQueryKey(issueKey),
    queryFn: () => api.get<CommentListResult>(`/issues/${issueKey}/comments?limit=100`),
    enabled: Boolean(issueKey),
  });
}

export function useCreateComment(issueKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateComment) => api.post<CommentWithAuthor>(`/issues/${issueKey}/comments`, body),
    onSuccess: (created) => {
      queryClient.setQueryData<CommentListResult>(commentsQueryKey(issueKey), (old) => {
        if (!old) return { items: [created], nextCursor: null };
        if (old.items.some((c) => c.id === created.id)) return old;
        return { ...old, items: [...old.items, created] };
      });
    },
  });
}

type UpdateCommentInput = {
  commentId: string;
  body: UpdateComment;
};

export function useUpdateComment(issueKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: UpdateCommentInput) =>
      api.patch<CommentWithAuthor>(`/comments/${commentId}`, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<CommentListResult>(commentsQueryKey(issueKey), (old) => {
        if (!old) return old;
        return {
          ...old,
          items: old.items.map((c) => (c.id === updated.id ? updated : c)),
        };
      });
    },
  });
}

export function useDeleteComment(issueKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.delete<{ success: true }>(`/comments/${commentId}`),
    onSuccess: (_result, commentId) => {
      queryClient.setQueryData<CommentListResult>(commentsQueryKey(issueKey), (old) => {
        if (!old) return old;
        return { ...old, items: old.items.filter((c) => c.id !== commentId) };
      });
    },
  });
}
