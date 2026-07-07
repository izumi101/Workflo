import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import {
  REALTIME_EVENTS,
  type Comment,
  type CommentWithAuthor,
  type CreateComment,
  type UpdateComment,
} from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { parseIssueKey } from "../common/issue-key.js";
import type { WorkspaceContext } from "../authz/workspace-context.js";

type CommentRow = {
  id: string;
  issueId: string;
  authorId: string;
  body: string;
  mentions: string[];
  createdAt: Date;
  updatedAt: Date;
};

type CommentRowWithAuthor = CommentRow & {
  author: { id: string; name: string; avatarUrl: string | null };
};

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    issueId: row.issueId,
    authorId: row.authorId,
    body: row.body,
    mentions: row.mentions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toCommentWithAuthor(row: CommentRowWithAuthor): CommentWithAuthor {
  return { ...toComment(row), author: row.author };
}

const AUTHOR_SELECT = { id: true, name: true, avatarUrl: true } as const;
const COMMENT_INCLUDE = { author: { select: AUTHOR_SELECT } } as const;

export interface CommentListResult {
  items: CommentWithAuthor[];
  nextCursor: string | null;
}

/** Resolved issue reference needed to scope comment reads/writes. */
interface IssueRef {
  id: string;
  projectId: string;
  workspaceId: string;
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Lists comments for the issue named by `key`, oldest-first,
   * cursor-paginated. `workspaceId` scopes the issue lookup to the workspace
   * WorkspaceMemberGuard already authorized the caller against for this key
   * (see the "issue:key" strategy) — Project.key collisions across
   * workspaces would otherwise let this resolve a foreign issue.
   */
  async listByIssueKey(key: string, workspaceId: string): Promise<CommentListResult>;
  async listByIssueKey(
    key: string,
    workspaceId: string,
    query: { cursor?: string; limit: number },
  ): Promise<CommentListResult>;
  async listByIssueKey(
    key: string,
    workspaceId: string,
    query: { cursor?: string; limit: number } = { limit: 50 },
  ): Promise<CommentListResult> {
    const issue = await this.findIssueByKey(key, workspaceId);

    const rows = await this.prisma.comment.findMany({
      where: { issueId: issue.id },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: "asc" },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;

    return { items: items.map(toCommentWithAuthor), nextCursor };
  }

  /**
   * Creates a comment on the issue named by `key`. Validates every
   * `mentionUserIds` entry is a member of the issue's workspace (400 listing
   * the offending ids), dedupes, and stores them in `mentions`. Emits
   * `comment.added` AFTER the DB write commits.
   */
  async create(
    key: string,
    workspaceId: string,
    authorId: string,
    input: CreateComment,
  ): Promise<CommentWithAuthor> {
    const issue = await this.findIssueByKey(key, workspaceId);
    const mentions = await this.resolveMentions(issue.workspaceId, input.mentionUserIds);

    const row = await this.prisma.comment.create({
      data: {
        issueId: issue.id,
        authorId,
        body: input.body,
        mentions,
      },
      include: COMMENT_INCLUDE,
    });

    const dto = toCommentWithAuthor(row);
    this.events.emit(REALTIME_EVENTS.COMMENT_ADDED, {
      ...toComment(row),
      projectId: issue.projectId,
      issueKey: key,
    });
    return dto;
  }

  /**
   * Author-only body edit. Re-validates/replaces `mentions` when
   * `mentionUserIds` is provided; leaves the existing mentions untouched
   * otherwise. Emits `comment.updated` AFTER commit.
   */
  async update(
    commentId: string,
    requesterId: string,
    input: UpdateComment,
  ): Promise<CommentWithAuthor> {
    const existing = await this.findCommentRef(commentId);
    if (existing.authorId !== requesterId) {
      throw new ForbiddenException("Only the comment's author can edit it");
    }

    const mentions =
      input.mentionUserIds !== undefined
        ? await this.resolveMentions(existing.workspaceId, input.mentionUserIds)
        : undefined;

    const row = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        body: input.body,
        ...(mentions !== undefined ? { mentions } : {}),
      },
      include: COMMENT_INCLUDE,
    });

    const dto = toCommentWithAuthor(row);
    this.events.emit(REALTIME_EVENTS.COMMENT_UPDATED, {
      ...toComment(row),
      projectId: existing.projectId,
      issueKey: existing.issueKey,
    });
    return dto;
  }

  /**
   * Deletable by the comment's author OR the workspace OWNER (per
   * `workspaceContext.role`, attached by WorkspaceMemberGuard for this
   * request). Emits `comment.deleted` AFTER commit.
   */
  async remove(commentId: string, requesterId: string, workspaceContext: WorkspaceContext): Promise<void> {
    const existing = await this.findCommentRef(commentId);
    const isAuthor = existing.authorId === requesterId;
    const isOwner = workspaceContext.role === "OWNER";
    if (!isAuthor && !isOwner) {
      throw new ForbiddenException("Only the comment's author or a workspace owner can delete it");
    }

    await this.prisma.comment.delete({ where: { id: commentId } });
    this.events.emit(REALTIME_EVENTS.COMMENT_DELETED, {
      projectId: existing.projectId,
      issueKey: existing.issueKey,
      commentId,
    });
  }

  /**
   * Looks up the issue by human key, scoped to `workspaceId` — the workspace
   * WorkspaceMemberGuard already authorized the caller against for this key
   * (see the "issue:key" strategy in workspace-member.guard.ts). Project.key
   * is only unique WITHIN a workspace, so without this scope a colliding key
   * in another workspace could resolve here instead. 404s if no issue
   * matches within that workspace.
   */
  private async findIssueByKey(key: string, workspaceId: string): Promise<IssueRef> {
    const { projectKey, number } = parseIssueKey(key);
    const issue = await this.prisma.issue.findFirst({
      where: { number, project: { key: projectKey, workspaceId } },
      select: { id: true, projectId: true, project: { select: { workspaceId: true } } },
    });
    if (!issue) {
      throw new NotFoundException("Issue not found");
    }
    return { id: issue.id, projectId: issue.projectId, workspaceId: issue.project.workspaceId };
  }

  /** Looks up a comment's identity plus its issue's key/project/workspace, for author/owner checks and event payloads. */
  private async findCommentRef(
    commentId: string,
  ): Promise<{ authorId: string; projectId: string; workspaceId: string; issueKey: string }> {
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        authorId: true,
        issue: {
          select: {
            number: true,
            project: { select: { key: true, id: true, workspaceId: true } },
          },
        },
      },
    });
    if (!comment) {
      throw new NotFoundException("Comment not found");
    }
    return {
      authorId: comment.authorId,
      projectId: comment.issue.project.id,
      workspaceId: comment.issue.project.workspaceId,
      issueKey: `${comment.issue.project.key}-${comment.issue.number}`,
    };
  }

  /** Validates and dedupes mention userIds against the issue's workspace membership. */
  private async resolveMentions(workspaceId: string, mentionUserIds?: string[]): Promise<string[]> {
    if (!mentionUserIds || mentionUserIds.length === 0) {
      return [];
    }

    const deduped = [...new Set(mentionUserIds)];
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: deduped } },
      select: { userId: true },
    });
    const memberIds = new Set(members.map((m) => m.userId));
    const offending = deduped.filter((id) => !memberIds.has(id));

    if (offending.length > 0) {
      throw new BadRequestException({
        message: "mentionUserIds must all be members of the issue's workspace",
        offending,
      });
    }

    return deduped;
  }
}
