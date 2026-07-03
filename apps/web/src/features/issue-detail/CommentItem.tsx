import { useState } from "react";
import type { CommentWithAuthor, WorkspaceMember } from "@workflo/shared";
import { formatRelativeTime } from "../../lib/relativeTime.js";
import { CommentBody } from "./CommentBody.js";

export function CommentItem({
  comment,
  members,
  canEdit,
  canDelete,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  comment: CommentWithAuthor;
  members: WorkspaceMember[];
  canEdit: boolean;
  canDelete: boolean;
  onSave: (body: string) => void;
  onDelete: () => void;
  saving?: boolean;
  deleting?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);

  const wasEdited = new Date(comment.updatedAt).getTime() > new Date(comment.createdAt).getTime();

  function startEdit() {
    setDraft(comment.body);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
  }

  function submitEdit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === comment.body) {
      setEditing(false);
      return;
    }
    onSave(trimmed);
    setEditing(false);
  }

  function handleDelete() {
    if (window.confirm("Delete this comment?")) {
      onDelete();
    }
  }

  return (
    <li className="comment">
      <div className="comment__header">
        <span className="comment__author">{comment.author.name}</span>
        <span className="comment__time">
          {formatRelativeTime(comment.createdAt)}
          {wasEdited ? <span className="comment__edited"> (edited)</span> : null}
        </span>
      </div>

      {editing ? (
        <div className="comment__edit">
          <textarea
            className="comment__edit-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
          />
          <div className="comment__edit-actions">
            <button type="button" onClick={submitEdit} disabled={saving}>
              Save
            </button>
            <button type="button" onClick={cancelEdit} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <CommentBody body={comment.body} mentions={comment.mentions} members={members} />
      )}

      {!editing && (canEdit || canDelete) ? (
        <div className="comment__actions">
          {canEdit ? (
            <button type="button" className="comment__action" onClick={startEdit}>
              Edit
            </button>
          ) : null}
          {canDelete ? (
            <button type="button" className="comment__action" onClick={handleDelete} disabled={deleting}>
              Delete
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
