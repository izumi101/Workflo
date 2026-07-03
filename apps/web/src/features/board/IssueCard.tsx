import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@workflo/shared";

function issueKey(issue: Issue, projectKey: string): string {
  return `${projectKey}-${issue.number}`;
}

export function IssueCard({
  issue,
  projectKey,
  assigneeInitial,
}: {
  issue: Issue;
  projectKey: string;
  assigneeInitial?: string | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`issue-card issue-card--${issue.priority.toLowerCase()}`}
    >
      <div className="issue-card__top">
        <span className="issue-card__key">{issueKey(issue, projectKey)}</span>
        {assigneeInitial ? <span className="issue-card__avatar">{assigneeInitial}</span> : null}
      </div>
      <p className="issue-card__title">{issue.title}</p>
      <span className={`issue-card__priority issue-card__priority--${issue.priority.toLowerCase()}`}>
        {issue.priority}
      </span>
    </div>
  );
}
