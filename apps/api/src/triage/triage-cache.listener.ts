import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { REALTIME_EVENTS, type Issue, type IssueDeletedEventPayload } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { TriageCacheService } from "./triage-cache.service.js";

/**
 * Bug fix (orchestrator verification, 2026-07-22): the 60s triage cache was
 * ONLY invalidated by `dismiss()`/`markSeen()` — any OTHER issue mutation
 * (assign, priority/status/due-date change, delete) left it stale for up to
 * a minute, so a section's own primary action (e.g. "Assign to me" on an
 * UNOWNED_URGENT row) appeared to silently no-op: the DB write succeeded but
 * the row kept showing in the next `GET /triage`.
 *
 * Mirrors `realtime/realtime.listener.ts`'s pattern exactly: `IssuesService`
 * already emits `issue.created`/`issue.updated`/`issue.moved` (bare `Issue`,
 * carrying `projectId`) and `issue.deleted` (`{projectId, issueId}`) via the
 * same internal NestJS event bus, AFTER the DB commit. This listener just
 * adds a second consumer of those same events — no new emission points, no
 * polling, no shortened TTL.
 *
 * Invalidates for the WHOLE workspace (`delByWorkspace`), not just the
 * acting user — an assignment or priority change alters what OTHER members
 * see in their own triage too (e.g. a row leaving UNOWNED_URGENT is true for
 * every member, not only the one who changed it).
 *
 * Deliberately does NOT subscribe to comment events: comment mutations only
 * affect NEEDS_REPLY, and a reply becoming reflected up to 60s later (the
 * cache's natural TTL) is an acceptable staleness window for that section —
 * unlike the other three sections' primary actions, there's no "I just did
 * a thing and it visibly didn't work" moment for comments here.
 *
 * Every handler is wrapped in try/catch and must never throw: a
 * cache-invalidation failure (e.g. the project lookup or Redis itself is
 * down) must never break the issue mutation or the realtime broadcast path
 * that triggered this listener.
 */
@Injectable()
export class TriageCacheListener {
  private readonly logger = new Logger(TriageCacheListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TriageCacheService,
  ) {}

  @OnEvent(REALTIME_EVENTS.ISSUE_CREATED)
  async onIssueCreated(issue: Issue): Promise<void> {
    await this.invalidateForProject(issue.projectId);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_UPDATED)
  async onIssueUpdated(issue: Issue): Promise<void> {
    await this.invalidateForProject(issue.projectId);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_MOVED)
  async onIssueMoved(issue: Issue): Promise<void> {
    await this.invalidateForProject(issue.projectId);
  }

  @OnEvent(REALTIME_EVENTS.ISSUE_DELETED)
  async onIssueDeleted(payload: IssueDeletedEventPayload): Promise<void> {
    await this.invalidateForProject(payload.projectId);
  }

  private async invalidateForProject(projectId: string): Promise<void> {
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { workspaceId: true },
      });
      if (!project) {
        // Benign race (e.g. the project itself was deleted moments after
        // emitting) — nothing to invalidate.
        return;
      }
      await this.cache.delByWorkspace(project.workspaceId);
    } catch (err) {
      this.logger.warn(`Triage cache invalidation failed for project ${projectId}: ${(err as Error).message}`);
    }
  }
}
