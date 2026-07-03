import type { WorkspaceMember } from "@workflo/shared";

/**
 * Small dropdown shown under the composer textarea while the user is
 * mid-typing an `@mention` token. Purely presentational — the composer owns
 * the "are we in a mention" state machine and calls `onPick`.
 */
export function MentionPicker({
  candidates,
  onPick,
}: {
  candidates: WorkspaceMember[];
  onPick: (member: WorkspaceMember) => void;
}) {
  if (candidates.length === 0) {
    return (
      <div className="mention-picker">
        <div className="mention-picker__empty">No matching members</div>
      </div>
    );
  }

  return (
    <div className="mention-picker">
      {candidates.map((member) => (
        <button
          key={member.userId}
          type="button"
          className="mention-picker__item"
          // onMouseDown (not onClick) so the textarea's blur/selection
          // change doesn't fire and close the picker before the pick is
          // registered.
          onMouseDown={(e) => {
            e.preventDefault();
            onPick(member);
          }}
        >
          <span className="mention-picker__name">{member.user.name}</span>
          <span className="mention-picker__email">{member.user.email}</span>
        </button>
      ))}
    </div>
  );
}
