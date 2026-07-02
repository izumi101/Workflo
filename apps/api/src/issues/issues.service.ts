import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CreateIssue, Issue, IssueListQuery, UpdateIssue } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { nextRank } from "../common/rank.js";
import { parseIssueKey } from "../common/issue-key.js";

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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates an issue in `projectId`. Allocates the human-readable `number`
   * atomically by incrementing `Project.counter` inside the same transaction
   * as the issue insert, so concurrent creates never collide or gap (see
   * CLAUDE.md §8 "Human key allocation").
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
          rank: nextRank(lastInStatus?.rank),
          labels: input.labelIds ? { connect: input.labelIds.map((id) => ({ id })) } : undefined,
        },
        include: ISSUE_INCLUDE,
      });
    });

    return toIssue(issue);
  }

  async listByProject(projectId: string, query: IssueListQuery): Promise<IssueListResult> {
    const where = {
      projectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.assigneeId ? { assigneeId: query.assigneeId } : {}),
      ...(query.labelId ? { labels: { some: { id: query.labelId } } } : {}),
      ...(query.q
        ? {
            OR: [
              { title: { contains: query.q, mode: "insensitive" as const } },
              { description: { contains: query.q, mode: "insensitive" as const } },
            ],
          }
        : {}),
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

  /** Looks up an issue by its human-readable key ("WF-123"). 404s if the project or issue doesn't exist. */
  async getByKey(key: string): Promise<Issue> {
    const { projectKey, number } = parseIssueKey(key);
    const issue = await this.prisma.issue.findFirst({
      where: { number, project: { key: projectKey } },
      include: ISSUE_INCLUDE,
    });
    if (!issue) {
      throw new NotFoundException("Issue not found");
    }
    return toIssue(issue);
  }

  async update(key: string, input: UpdateIssue): Promise<Issue> {
    const existing = await this.findRowByKey(key);
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

    return toIssue(issue);
  }

  async remove(key: string): Promise<void> {
    const existing = await this.findRowByKey(key);
    await this.prisma.issue.delete({ where: { id: existing.id } });
  }

  private async findRowByKey(key: string): Promise<{ id: string; projectId: string }> {
    const { projectKey, number } = parseIssueKey(key);
    const issue = await this.prisma.issue.findFirst({
      where: { number, project: { key: projectKey } },
      select: { id: true, projectId: true },
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
}
