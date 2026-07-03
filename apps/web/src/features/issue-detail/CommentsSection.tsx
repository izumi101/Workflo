import type { WorkspaceMember } from "@workflo/shared";
import { useAuthStore } from "../../store/auth.store.js";
import { CommentComposer } from "./CommentComposer.js";
import { CommentItem } from "./CommentItem.js";
import { useCreateComment, useDeleteComment, useIssueComments, useUpdateComment } from "./comment.queries.js";

export function CommentsSection({ issueKey, members }: { issueKey: string; members: WorkspaceMember[] }) {
  const { data, isPending, isError } = useIssueComments(issueKey);
  const createComment = useCreateComment(issueKey);
  const updateComment = useUpdateComment(issueKey);
  const deleteComment = useDeleteComment(issueKey);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentMember = members.find((m) => m.userId === currentUserId);
  const isOwner = currentMember?.role === "OWNER";

  if (isPending) {
    return <p className="board-status">Loading comments…</p>;
  }
  if (isError) {
    return <p className="board-status board-status--error">Failed to load comments.</p>;
  }

  const comments = data?.items ?? [];

  return (
    <section className="comments-section">
      <h2 className="comments-section__title">Comments ({comments.length})</h2>

      <ul className="comments-list">
        {comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            members={members}
            canEdit={comment.authorId === currentUserId}
            canDelete={comment.authorId === currentUserId || isOwner}
            saving={updateComment.isPending && updateComment.variables?.commentId === comment.id}
            deleting={deleteComment.isPending && deleteComment.variables === comment.id}
            onSave={(body) => updateComment.mutate({ commentId: comment.id, body: { body } })}
            onDelete={() => deleteComment.mutate(comment.id)}
          />
        ))}
        {comments.length === 0 ? <li className="comments-list__empty">No comments yet.</li> : null}
      </ul>

      <CommentComposer
        members={members}
        submitting={createComment.isPending}
        onSubmit={(body, mentionUserIds) =>
          createComment.mutate({ body, mentionUserIds: mentionUserIds.length > 0 ? mentionUserIds : undefined })
        }
      />
    </section>
  );
}
