import { Fragment } from "react";
import type { WorkspaceMember } from "@workflo/shared";

/**
 * Renders a comment body, highlighting `@Name` occurrences for any name
 * that matches a mentioned userId in `mentions` against the workspace
 * members list. Simple split/regex match — not a markdown renderer (MVP
 * comments are plain text, see CLAUDE.md §5).
 */
export function CommentBody({
  body,
  mentions,
  members,
}: {
  body: string;
  mentions: string[];
  members: WorkspaceMember[];
}) {
  const mentionedNames = new Set(
    mentions
      .map((userId) => members.find((m) => m.userId === userId)?.user.name)
      .filter((name): name is string => Boolean(name)),
  );

  if (mentionedNames.size === 0) {
    return <p className="comment__body">{body}</p>;
  }

  // Build one alternation regex over all mentioned names (longest first so
  // a name that's a prefix of another doesn't shadow it), split, and
  // re-wrap the `@Name` matches in a highlight span.
  const sortedNames = [...mentionedNames].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(@(?:${sortedNames.map(escapeRegExp).join("|")}))\\b`, "g");
  const parts = body.split(pattern);

  return (
    <p className="comment__body">
      {parts.map((part, i) => {
        const name = part.startsWith("@") ? part.slice(1) : null;
        if (name && mentionedNames.has(name)) {
          return (
            <span key={i} className="comment__mention">
              {part}
            </span>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </p>
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
