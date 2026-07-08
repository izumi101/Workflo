import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { InjectQueue } from "@nestjs/bullmq";
import type { Queue } from "bullmq";
import { Prisma } from "@prisma/client";
import {
  rankBetween,
  REALTIME_EVENTS,
  type CreateIssue,
  type Issue,
  type IssueListQuery,
  type MoveIssue,
  type UpdateIssue,
} from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { parseIssueKey } from "../common/issue-key.js";
import { issueFtsMatch } from "../common/fts.js";
import { NOTIFICATIONS_QUEUE, NOTIFICATION_JOBS, type NotificationJobData } from "../notifications/notification-job.js";

type IssueRow = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  description: string | null;
  type: "TASK" | "BUG" | "EPIC";
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  assigneeId: string | null;
  reporterId: string;
  parentId: string | null;
  rank: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  labels: { id: string }[];
};

function toIssue(issue: IssueRow): Issue {
  return {
    id: issue.id,
    projectId: issue.projectId,
    number: issue.number,
    title: issue.title,
    description: issue.description,
    type: issue.type,
    status: issue.status,
    priority: issue.priority,
    assigneeId: issue.assigneeId,
    reporterId: issue.reporterId,
    parentId: issue.parentId,
    labelIds: issue.labels.map((l) => l.id),
    rank: issue.rank,
    dueDate: issue.dueDate,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

const ISSUE_INCLUDE = { labels: { select: { id: true } } } as const;

export interface IssueListResult {
  items: Issue[];
  nextCursor: string | null;
}

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @InjectQueue(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue<NotificationJobData>,
  ) {}

  /**
   * Creates an issue in `projectId`. Allocates the human-readable `number`
   * atomically by incrementing `Project.counter` inside the same transaction
   * as the issue insert, so concurrent creates never collide or gap (see
   * CLAUDE.md §8 "Human key allocation"). If `assigneeId` is set (and isn't
   * the reporter/actor themselves), enqueues an `assign` notification job
   * AFTER the DB commit — no self-notify on self-assignment.
   */
  async create(projectId: string, reporterId: string, input: CreateIssue): Promise<Issue> {
    await this.assertRefsBelongToProject(projectId, input);

    const issue = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id: projectId },
        data: { counter: { increment: 1 } },
        select: { counter: true },
      });

      const lastInStatus = await tx.issue.findFirst({
        where: { projectId, status: "TODO" },
        orderBy: { rank: "desc" },
        select: { rank: true },
      });

      return tx.issue.create({
        data: {
          projectId,
          number: project.counter,
          title: input.title,
          description: input.description ?? null,
          type: input.type ?? "TASK",
          priority: input.priority ?? "MEDIUM",
          assigneeId: input.assigneeId ?? null,
          reporterId,
          parentId: input.parentId ?? null,
          dueDate: input.dueDate ?? null,
          rank: rankBetween(lastInStatus?.rank ?? null, null),
          labels: input.labelIds ? { connect: input.labelIds.map((id) => ({ id })) } : undefined,
        },
        include: ISSUE_INCLUDE,
      });
    });

    const dto = toIssue(issue);
    // Bare Issue on the wire (it already carries projectId) — see
    // packages/shared/src/realtime.ts's issueEventPayloadSchema doc comment.
    this.events.emit(REALTIME_EVENTS.ISSUE_CREATED, dto);

    if (dto.assigneeId) {
      await this.enqueueAssignJob(dto.assigneeId, reporterId, dto);
    }

    return dto;
  }

  /**
   * Lists issues in `projectId`, optionally narrowed by status/assignee/label
   * and by `q` — a real Postgres full-text search (ADR-0006), not a `contains`
   * placeholder. When `q` is present, a raw `$queryRaw` first resolves the
   * matching issue ids via the FTS predicate (see `issueFtsMatch`, which
   * matches the functional GIN index `Issue_fts_idx`), then feeds that id set
   * into the existing Prisma `where` so status/assigneeId/labelId + cursor
   * pagination + `[status, rank]` ordering all keep working unchanged. Empty
   * `q` skips FTS entirely (unchanged behavior from before ADR-0006 landed).
   */
  async listByProject(projectId: string, query: IssueListQuery): Promise<IssueListResult> {
    const matchingIds = query.q ? await this.findMatchingIssueIds(projectId, query.q) : null;

    // FTS narrowed to zero matches -> short-circuit to an empty page instead
    // of asking Prisma for `id IN ()` (works either way, but this is clearer).
    if (matchingIds && matchingIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const where = {
      projectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.labelId ? { labels: { some: { id: query.labelId } } } : {}),
      ...(matchingIds ? { id: { in: matchingIds } } : {}),
    };

    const rows = await this.prisma.issue.findMany({
      where,
      include: ISSUE_INCLUDE,
      orderBy: [{ status: "asc" }, { rank: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    return { items: items.map(toIssue), nextCursor };
  }

  /**
   * Resolves the ids of issues in `projectId` whose title/description match
   * `q` via Postgres FTS (`websearch_to_tsquery`, tolerates arbitrary input —
   * never throws). Parameterized via `Prisma.sql`; `q` is never
   * string-concatenated into the query.
   */
  private async findMatchingIssueIds(projectId: string, q: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        SELECT "id" FROM "Issue"
        WHERE "projectId" = ${projectId}
          AND ${issueFtsMatch(q)}
      `,
    );
    return rows.map((r) => r.id);
  }

  /**
   * Looks up an issue by its human-readable key ("WF-123"), scoped to
   * `workspaceId` — the workspace WorkspaceMemberGuard already authorized the
   * caller against for this exact key (see the "issue:key" strategy in
   * workspace-member.guard.ts). Project.key is only unique WITHIN a
   * workspace, so without this scope a colliding key in another workspace
   * could be returned instead. 404s if no issue matches within that
   * workspace.
   */
  async getByKey(key: string, workspaceId: string): Promise<Issue> {
    const { projectKey, number } = parseIssueKey(key);
    const issue = await this.prisma.issue.findFirst({
      where: { number, project: { key: projectKey, workspaceId } },
      include: ISSUE_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException("Issue not found");
    }
    return toIssue(issue);
  }

  /**
   * Partial update. If `input.assigneeId` is provided and differs from the
   * issue's PREVIOUS assigneeId (i.e. it actually changed) and the new value
   * is non-null, enqueues an `assign` notification job for the new assignee
   * AFTER the DB commit — excluding `actorId` (no self-notify on
   * self-assignment). Clearing an assignee (`assigneeId: null`) or leaving it
   * unchanged never enqueues anything.
   */
  async update(key: string, workspaceId: string, actorId: string, input: UpdateIssue): Promise<Issue> {
    const existing = await this.findRowByKey(key, workspaceId);
    await this.assertRefsBelongToProject(existing.projectId, input);

    const issue = await this.prisma.issue.update({
      where: { id: existing.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.rank !== undefined ? { rank: input.rank } : {}),
        ...(input.labelIds !== undefined
          ? { labels: { set: input.labelIds.map((id) => ({ id })) } }
          : {}),
      },
      include: ISSUE_INCLUDE,
    });

    const dto = toIssue(issue);
    // Bare Issue on the wire (it already carries projectId) — see
    // packages/shared/src/realtime.ts's issueEventPayloadSchema doc comment.
    this.events.emit(REALTIME_EVENTS.ISSUE_UPDATED, dto);

    const assigneeChanged =
      input.assigneeId !== undefined && input.assigneeId !== null && input.assigneeId !== existing.assigneeId;
    if (assigneeChanged) {
      await this.enqueueAssignJob(dto.assigneeId as string, actorId, dto);
    }

    return dto;
  }

  /**
   * Server-authoritative board reposition: moves the issue identified by
   * `key` to `input.status`, placed between the issues named by
   * `input.afterIssueId` (comes right after) and `input.beforeIssueId`
   * (comes right before). Both are optional — omitting both places the
   * issue at the end of the target column. The neighbors are re-loaded from
   * the DB (never trust client-supplied ranks) and must belong to the SAME
   * project as the moved issue and to the target `status` column, otherwise
   * this 400s. Status + rank are written in a single update.
   *
   * Rebalance hook: if `rankBetween` keys keep growing for a hot column,
   * a periodic job could re-derive short, evenly-spaced ranks scoped to
   * `[projectId, status]` right here — no change needed to this method's
   * external contract (see rankBetween's doc comment in packages/shared).
   */
  async move(key: string, workspaceId: string, input: MoveIssue): Promise<Issue> {
    const existing = await this.findRowByKey(key, workspaceId);

    const [beforeIssue, afterIssue] = await Promise.all([
      input.beforeIssueId ? this.findNeighbor(input.beforeIssueId) : Promise.resolve(null),
      input.afterIssueId ? this.findNeighbor(input.afterIssueId) : Promise.resolve(null),
    ]);

    for (const neighbor of [beforeIssue, afterIssue]) {
      if (!neighbor) continue;
      if (neighbor.projectId !== existing.projectId) {
        throw new BadRequestException("Neighbor issue must belong to the same project");
      }
      if (neighbor.status !== input.status) {
        throw new BadRequestException("Neighbor issue must belong to the target status column");
      }
    }

    const rank = rankBetween(afterIssue?.rank ?? null, beforeIssue?.rank ?? null);

    const issue = await this.prisma.issue.update({
      where: { id: existing.id },
      data: { status: input.status, rank },
      include: ISSUE_INCLUDE,
    });

    const dto = toIssue(issue);
    // Bare Issue on the wire (it already carries projectId) — see
    // packages/shared/src/realtime.ts's issueEventPayloadSchema doc comment.
    this.events.emit(REALTIME_EVENTS.ISSUE_MOVED, dto);
    return dto;
  }

  private async findNeighbor(
    id: string,
  ): Promise<{ id: string; projectId: string; status: "TODO" | "IN_PROGRESS" | "DONE"; rank: string }> {
    const neighbor = await this.prisma.issue.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, rank: true },
    });
    if (!neighbor) {
      throw new BadRequestException("Neighbor issue not found");
    }
    return neighbor;
  }

  async remove(key: string, workspaceId: string): Promise<void> {
    const existing = await this.findRowByKey(key, workspaceId);
    await this.prisma.issue.delete({ where: { id: existing.id } });
    this.events.emit(REALTIME_EVENTS.ISSUE_DELETED, {
      projectId: existing.projectId,
      issueId: existing.id,
    });
  }

  /**
   * Resolves the human key to its row id/projectId, scoped to `workspaceId`
   * (the workspace the caller was already authorized against for this exact
   * key by WorkspaceMemberGuard's "issue:key" strategy). This ensures
   * update/move/remove operate on the SAME issue the guard authorized,
   * closing the gap where the guard could authorize the caller's own
   * same-keyed issue while the service resolved a different (foreign)
   * workspace's colliding key.
   */
  private async findRowByKey(
    key: string,
    workspaceId: string,
  ): Promise<{ id: string; projectId: string; assigneeId: string | null }> {
    const { projectKey, number } = parseIssueKey(key);
    const issue = await this.prisma.issue.findFirst({
      where: { number, project: { key: projectKey, workspaceId } },
      select: { id: true, projectId: true, assigneeId: true },
    });
    if (!issue) {
      throw new NotFoundException("Issue not found");
    }
    return issue;
  }

  /** Validates that assigneeId/parentId/labelIds referenced by the input belong to the same project/workspace. */
  private async assertRefsBelongToProject(
    projectId: string,
    input: Pick<CreateIssue, "assigneeId" | "parentId" | "labelIds">,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException("Project not found");
    }

    if (input.assigneeId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: project.workspaceId, userId: input.assigneeId } },
      });
      if (!member) {
        throw new BadRequestException("assigneeId must be a member of the issue's workspace");
      }
    }

    if (input.parentId) {
      const parent = await this.prisma.issue.findUnique({ where: { id: input.parentId } });
      if (!parent || parent.projectId !== projectId) {
        throw new BadRequestException("parentId must be an issue in the same project");
      }
    }

    if (input.labelIds && input.labelIds.length > 0) {
      const labels = await this.prisma.label.findMany({
        where: { id: { in: input.labelIds } },
        select: { id: true, projectId: true },
      });
      const allBelong =
        labels.length === input.labelIds.length && labels.every((l) => l.projectId === projectId);
      if (!allBelong) {
        throw new BadRequestException("labelIds must all belong to the same project");
      }
    }
  }

  /**
   * Enqueues an `assign` notification job for `assigneeId`, excluding
   * `actorId` (no self-notify on self-assignment). Resolves the issue's
   * human key (`WF-123`) via one extra lightweight lookup — only called on
   * the (uncommon) path where an assignment actually happened, so it doesn't
   * add a query to the common create/update case with no assignee change.
   */
  private async enqueueAssignJob(assigneeId: string, actorId: string, issue: Issue): Promise<void> {
    if (assigneeId === actorId) {
      return;
    }

    const project = await this.prisma.project.findUnique({
      where: { id: issue.projectId },
      select: { key: true },
    });
    const issueKey = `${project?.key ?? "?"}-${issue.number}`;

    await this.notificationsQueue.add(NOTIFICATION_JOBS.ASSIGNED, {
      userId: assigneeId,
      type: "ASSIGNED",
      actorId,
      issueKey,
      projectId: issue.projectId,
    } satisfies NotificationJobData);
  }
}
