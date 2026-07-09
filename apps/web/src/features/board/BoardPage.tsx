import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  DragOverlay,
  type DropAnimation,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Issue, IssueStatus, Project } from "@workflo/shared";
import { rankBetween } from "@workflo/shared";
import { groupByStatus, issuesQueryKey, useCreateIssue, useMoveIssue, useProjectIssues } from "./board.queries.js";
import type { IssueListResult } from "./board.queries.js";
import { Column } from "./Column.js";
import { IssueCard } from "./IssueCard.js";
import { useBoardRealtime } from "./useBoardRealtime.js";
import { api } from "../../lib/api.js";
import { useAuthStore } from "../../store/auth.store.js";
import { useActiveWorkspaceStore } from "../../store/active-workspace.store.js";
import { ViewToggle } from "../../components/ViewToggle.js";

// The board's own reorder (via `queryClient.setQueryData` in handleDragEnd,
// below) is applied outside of dnd-kit's internal state, and — because it
// goes through a React Query cache write + re-render rather than a
// synchronous local `arrayMove` — it hasn't committed to the DOM yet at the
// exact instant `onDragEnd` fires. dnd-kit's *default* drop animation
// interpolates the overlay's transform toward the dragged item's measured
// "final" resting position, but since that position isn't live yet on a
// cross-column move, the measurement is stale — the overlay's motion either
// snaps to the wrong spot or (as verified by direct DOM instrumentation
// during this fix) simply vanishes with zero visible animation, followed
// ~1 frame later by the real card hard-cutting into its new column with no
// transition at all. That hard cut is the reported "reverse-drag jank"
// (confirmed present, symmetrically, in both directions — just more
// noticeable going right-to-left against the reading-order the eye already
// tracked). Fix: never depend on the (unreliable) final-position
// measurement — fade the overlay out in place instead, so there's no
// snap-to-stale-coordinates to see, and the underlying reflow lands
// underneath a fully-transparent overlay rather than popping into view.
const dropAnimation: DropAnimation = {
  duration: 180,
  easing: "ease",
  keyframes: ({ transform }) => [
    { opacity: 1, transform: CSS.Transform.toString(transform.initial) },
    { opacity: 0, transform: CSS.Transform.toString(transform.initial) },
  ],
};

const STATUSES: IssueStatus[] = ["TODO", "IN_PROGRESS", "DONE"];

function useProjectById(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.get<Project>(`/projects/${projectId}`),
  });
}

export function BoardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  if (!projectId) {
    return <p>Missing project id.</p>;
  }
  return <BoardPageInner projectId={projectId} />;
}

function BoardPageInner({ projectId }: { projectId: string }) {
  const { data, isPending, isError } = useProjectIssues(projectId);
  const createIssue = useCreateIssue(projectId);
  const moveIssue = useMoveIssue(projectId);
  const queryClient = useQueryClient();

  // The board route only has `projectId` (a cuid), but issue human-keys
  // and the move endpoint need the project's short `key` (e.g. "WF").
  const { data: project } = useProjectById(projectId);
  const projectKey = project?.key ?? "";

  const setActiveWorkspace = useActiveWorkspaceStore((s) => s.setActiveWorkspace);
  useEffect(() => {
    if (project) {
      setActiveWorkspace({ workspaceId: project.workspaceId, name: projectKey });
    }
  }, [project, projectKey, setActiveWorkspace]);

  const { onlineUserIds } = useBoardRealtime(projectId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const onlineCount = new Set([...onlineUserIds, ...(currentUserId ? [currentUserId] : [])]).size;

  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    // Keyboard-first pitch (CLAUDE.md §1): a focused card can be picked up
    // with Space/Enter, moved between/within columns with the arrow keys,
    // and dropped with Space/Enter; Escape cancels back to the start
    // position. `sortableKeyboardCoordinates` only knows about the single
    // SortableContext it's invoked from, so cross-column moves land on the
    // nearest edge of the adjacent column — good enough to reach every
    // column via the arrow keys, same as pointer drag-and-drop.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const groups = useMemo(() => groupByStatus(data?.items ?? []), [data]);

  function findIssue(id: string): Issue | undefined {
    return data?.items.find((i) => i.id === id);
  }

  function findColumnOfIssue(id: string): IssueStatus | undefined {
    for (const status of STATUSES) {
      if (groups[status].some((i) => i.id === id)) return status;
    }
    return undefined;
  }

  function handleDragStart(event: DragStartEvent) {
    const issue = findIssue(String(event.active.id));
    setActiveIssue(issue ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveIssue(null);
    const { active, over } = event;
    if (!over || !data) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const sourceStatus = findColumnOfIssue(activeId);
    if (!sourceStatus) return;

    // The drop target is either a column (empty column droppable id) or
    // another card (use its column).
    const targetStatus: IssueStatus = (STATUSES as string[]).includes(overId)
      ? (overId as IssueStatus)
      : (findColumnOfIssue(overId) ?? sourceStatus);

    const draggedIssue = findIssue(activeId);
    if (!draggedIssue) return;

    // Build the target column's ordered id list with the dragged issue
    // removed, then figure out where it lands (index of the card we
    // dropped on, or end-of-column if we dropped on the column itself).
    const targetItems = groups[targetStatus].filter((i) => i.id !== activeId);
    let insertIndex = targetItems.findIndex((i) => i.id === overId);
    if (insertIndex === -1) {
      insertIndex = targetItems.length;
    }

    const before = targetItems[insertIndex - 1] ?? null;
    const after = targetItems[insertIndex] ?? null;

    const optimisticRank = rankBetween(before?.rank ?? null, after?.rank ?? null);
    const optimisticIssue: Issue = { ...draggedIssue, status: targetStatus, rank: optimisticRank };

    const previous = queryClient.getQueryData<IssueListResult>(issuesQueryKey(projectId));

    queryClient.setQueryData<IssueListResult>(issuesQueryKey(projectId), (old) => {
      if (!old) return old;
      return {
        ...old,
        items: old.items.map((i) => (i.id === activeId ? optimisticIssue : i)),
      };
    });

    moveIssue.mutate(
      {
        issueKey: `${projectKey}-${draggedIssue.number}`,
        body: {
          status: targetStatus,
          beforeIssueId: before?.id ?? undefined,
          afterIssueId: after?.id ?? undefined,
        },
      },
      {
        onError: () => {
          if (previous) {
            queryClient.setQueryData<IssueListResult>(issuesQueryKey(projectId), previous);
          } else {
            queryClient.invalidateQueries({ queryKey: issuesQueryKey(projectId) });
          }
        },
      },
    );
  }

  if (isPending) {
    return <p className="board-status">Loading board…</p>;
  }
  if (isError) {
    return <p className="board-status board-status--error">Failed to load issues.</p>;
  }

  return (
    <main className="board-page">
      <div className="board-page__header">
        <h1 className="board-page__title">{projectKey || "Board"}</h1>
        <ViewToggle projectId={projectId} active="board" />
        <span className="presence-chip" title="Members currently viewing this board">
          <span className="presence-chip__dot" />
          {onlineCount} online
        </span>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="board-columns">
          {STATUSES.map((status) => (
            <Column
              key={status}
              status={status}
              issues={groups[status]}
              projectKey={projectKey}
              assigneeInitials={{}}
              showCreateForm={status === "TODO"}
              creating={createIssue.isPending}
              onCreateIssue={(title) => createIssue.mutate({ title, type: "TASK", priority: "MEDIUM" })}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={dropAnimation}>
          {activeIssue ? <IssueCard issue={activeIssue} projectKey={projectKey} /> : null}
        </DragOverlay>
      </DndContext>
    </main>
  );
}
