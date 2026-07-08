import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@workflo/shared";

function issueKey(issue: Issue, projectKey: string): string {
  return `${projectKey}-${issue.number}`;
}

// dnd-kit's PointerSensor (activationConstraint: { distance: 4 } in
// BoardPage.tsx) only starts a drag once the pointer has moved past this
// distance, but its `listeners` still capture pointerdown unconditionally.
// To let a plain click navigate to the issue detail page without
// interfering with dragging, track the pointerdown position ourselves and
// only navigate on pointerup if the pointer barely moved (i.e. dnd-kit
// never promoted this gesture to a drag).
const CLICK_MOVE_THRESHOLD = 4;

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
  const navigate = useNavigate();
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  // While this card is the one being dragged, the DragOverlay (see
  // BoardPage.tsx) renders the "flying" copy that actually follows the
  // pointer/keyboard — this original node just sits in place as a
  // placeholder. Fully hiding it (rather than the previous opacity 0.5)
  // means only the overlay is ever visible mid-drag, so there's nothing
  // left behind to visually fight the overlay's own transform/fade — a
  // fix for the reported cross-column drag jank (see the `dropAnimation`
  // comment in BoardPage.tsx for the full root-cause writeup).
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  function handlePointerDown(e: React.PointerEvent) {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  }

  function handlePointerUp(e: React.PointerEvent) {
    const start = pointerDownPos.current;
    pointerDownPos.current = null;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx <= CLICK_MOVE_THRESHOLD && dy <= CLICK_MOVE_THRESHOLD) {
      navigate(`/issues/${issueKey(issue, projectKey)}`);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onPointerDown={(e) => {
        listeners?.onPointerDown?.(e);
        handlePointerDown(e);
      }}
      onPointerUp={handlePointerUp}
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
