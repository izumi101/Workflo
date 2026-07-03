import { type ChangeEvent, type KeyboardEvent, useMemo, useRef, useState } from "react";
import type { WorkspaceMember } from "@workflo/shared";
import { MentionPicker } from "./MentionPicker.js";

type MentionState = {
  /** index in `body` right after the triggering "@" */
  start: number;
  query: string;
};

/**
 * Textarea + mention picker + chips for a new comment. Typing "@" starts
 * tracking a mention token; as the user keeps typing without whitespace we
 * treat it as a filter query against workspace member names/emails. Picking
 * a candidate replaces the in-progress "@query" with "@Name" in the text and
 * adds the userId to the mentionUserIds set (shown as a removable chip).
 */
export function CommentComposer({
  members,
  onSubmit,
  submitting,
}: {
  members: WorkspaceMember[];
  onSubmit: (body: string, mentionUserIds: string[]) => void;
  submitting?: boolean;
}) {
  const [body, setBody] = useState("");
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const [mentionedIds, setMentionedIds] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const candidates = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query.toLowerCase();
    return members
      .filter(
        (m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [mentionState, members]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    setBody(value);

    const caret = e.target.selectionStart ?? value.length;
    const uptoCaret = value.slice(0, caret);
    const atIndex = uptoCaret.lastIndexOf("@");

    if (atIndex === -1) {
      setMentionState(null);
      return;
    }

    const between = uptoCaret.slice(atIndex + 1);
    // Stop tracking once whitespace/newline breaks the token.
    if (/\s/.test(between)) {
      setMentionState(null);
      return;
    }

    setMentionState({ start: atIndex, query: between });
  }

  function pickMention(member: WorkspaceMember) {
    if (!mentionState) return;
    const before = body.slice(0, mentionState.start);
    const after = body.slice(mentionState.start + 1 + mentionState.query.length);
    const insertion = `@${member.user.name}`;
    const nextBody = `${before}${insertion} ${after}`;
    setBody(nextBody);
    setMentionState(null);
    setMentionedIds((prev) => (prev.includes(member.userId) ? prev : [...prev, member.userId]));

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const caret = before.length + insertion.length + 1;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  function removeMention(userId: string) {
    setMentionedIds((prev) => prev.filter((id) => id !== userId));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && mentionState) {
      setMentionState(null);
    }
  }

  function handleSubmit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSubmit(trimmed, mentionedIds);
    setBody("");
    setMentionedIds([]);
    setMentionState(null);
  }

  const mentionedMembers = mentionedIds
    .map((id) => members.find((m) => m.userId === id))
    .filter((m): m is WorkspaceMember => Boolean(m));

  return (
    <div className="comment-composer">
      <div className="comment-composer__input-wrap">
        <textarea
          ref={textareaRef}
          className="comment-composer__textarea"
          placeholder="Write a comment… use @ to mention someone"
          rows={3}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
        {mentionState ? <MentionPicker candidates={candidates} onPick={pickMention} /> : null}
      </div>

      {mentionedMembers.length > 0 ? (
        <div className="mention-chips">
          {mentionedMembers.map((m) => (
            <span key={m.userId} className="mention-chip">
              @{m.user.name}
              <button
                type="button"
                className="mention-chip__remove"
                onClick={() => removeMention(m.userId)}
                aria-label={`Remove mention of ${m.user.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="comment-composer__actions">
        <button type="button" onClick={handleSubmit} disabled={submitting || !body.trim()}>
          Comment
        </button>
      </div>
    </div>
  );
}
