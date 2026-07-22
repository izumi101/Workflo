import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Priority, QueryResult, TriageResponse, TriageSection, TriageSectionKey, WorkfloQuery } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { QueryExecutionService } from "../query/query-execution.service.js";
import type { CompileContext } from "../query/query-compiler.service.js";
import { ISSUE_INCLUDE, toQueryResult, type IssueRow } from "../query/issue-result.mapper.js";
import { TriageCacheService } from "./triage-cache.service.js";

interface SectionDef {
  key: TriageSectionKey;
  title: string;
  description: string;
  /** The canned AST behind this section — null for NEEDS_REPLY (bespoke comment-join, no AST representation). */
  ast: WorkfloQuery | null;
  cap: number;
}

/** Section order + canned ASTs, exactly as specified (docs/design/nlq-search.md §2.7). */
const SECTION_DEFS: readonly SectionDef[] = [
  {
    key: "OVERDUE",
    title: "Overdue",
    description: "Assigned to you, past due",
    ast: { v: 1, assignee: "me", status: { not: "DONE" }, due: { overdue: true } },
    cap: 10,
  },
  {
    key: "GOING_STALE",
    title: "Going stale",
    description: "Assigned to you, untouched for over 7 days",
    ast: { v: 1, assignee: "me", status: { not: "DONE" }, updated: { olderThanDays: 7 } },
    cap: 10,
  },
  {
    key: "NEEDS_REPLY",
    title: "Needs your reply",
    description: "You were mentioned and haven't replied",
    ast: null,
    cap: 10,
  },
  {
    key: "UNOWNED_URGENT",
    title: "Unowned & urgent",
    description: "Nobody owns these and they're high priority",
    ast: { v: 1, assignee: "unassigned", priority: { atLeast: "HIGH" }, status: { not: "DONE" } },
    cap: 5,
  },
];

/** Requesting `cap + SLACK` rows per section so post-filtering out active
 * dismissals never starves a section below its real cap. */
const DISMISSAL_SLACK = 25;

/** §2.7 "Noise budget: <=25 rows" total across every section, applied in
 * section order (SECTION_DEFS' fixed order) — once the budget is spent,
 * later sections are truncated to empty and therefore dropped entirely. */
const GLOBAL_ROW_BUDGET = 25;

const TRIAGE_CACHE_TTL_SECONDS = 60;

const PRIORITY_RANK: Record<Priority, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, URGENT: 3 };

type DismissalRow = {
  issueId: string;
  section: string;
  priorityAtDismiss: Priority;
  wasOverdueAtDismiss: boolean;
};

/**
 * Smart Triage (docs/design/nlq-search.md §2.7) — computes the 4-section,
 * per-user "attention without asking" surface. Three sections are just
 * canned `WorkfloQuery` ASTs run through the EXISTING `QueryExecutionService`
 * (reuse, don't reinvent — same discipline as the rest of the query engine);
 * `NEEDS_REPLY` is a bespoke comment-join with no AST representation.
 *
 * Generation is on-demand at `GET /triage`, cached 60s per (workspace, user)
 * via `TriageCacheService` — no BullMQ, no push (§3.4 "pull, not push").
 */
@Injectable()
export class TriageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queryExecution: QueryExecutionService,
    private readonly cache: TriageCacheService,
  ) {}

  async getTriage(
    workspaceId: string,
    userId: string,
    now: Date,
    tzOffsetMinutes: number,
  ): Promise<TriageResponse> {
    const cacheKey = TriageCacheService.cacheKey(workspaceId, userId);

    const cached = await this.safeCacheGet(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.compute(workspaceId, userId, now, tzOffsetMinutes);
    await this.safeCacheSet(cacheKey, result);
    return result;
  }

  /**
   * Suppresses a dismissed issue in `section` for 7 days, snapshotting the
   * issue's priority/overdue state at dismiss time so `compute()` can detect
   * escalation (priority raised, or the issue became overdue after being
   * dismissed while not-yet-overdue) and show it again without ever deleting
   * the dismissal row. Invalidates the caller's triage cache immediately so
   * the dismissed row disappears from the very next GET instead of after the
   * 60s TTL.
   */
  async dismiss(userId: string, issueId: string, section: TriageSectionKey, now: Date): Promise<{ ok: true }> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { priority: true, dueDate: true, project: { select: { workspaceId: true } } },
    });
    if (!issue) {
      throw new NotFoundException("Issue not found");
    }

    const until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const wasOverdueAtDismiss = issue.dueDate !== null && issue.dueDate <= now;

    await this.prisma.triageDismissal.upsert({
      where: { userId_issueId_section: { userId, issueId, section } },
      create: { userId, issueId, section, until, priorityAtDismiss: issue.priority, wasOverdueAtDismiss },
      update: { until, priorityAtDismiss: issue.priority, wasOverdueAtDismiss },
    });

    await this.safeCacheDel(TriageCacheService.cacheKey(issue.project.workspaceId, userId));
    return { ok: true };
  }

  /** Updates the caller's last-visit marker for this workspace (drives the "new since last visit" badge) and invalidates their cache, since the badge is embedded in the cached payload. */
  async markSeen(userId: string, workspaceId: string, now: Date): Promise<{ ok: true }> {
    await this.prisma.triageSeen.upsert({
      where: { userId_workspaceId: { userId, workspaceId } },
      create: { userId, workspaceId, lastSeenAt: now },
      update: { lastSeenAt: now },
    });

    await this.safeCacheDel(TriageCacheService.cacheKey(workspaceId, userId));
    return { ok: true };
  }

  private async compute(
    workspaceId: string,
    userId: string,
    now: Date,
    tzOffsetMinutes: number,
  ): Promise<TriageResponse> {
    const ctx: CompileContext = { workspaceId, userId, now, tzOffsetMinutes };
    const dismissals = await this.loadActiveDismissals(userId, now);

    const filteredBySection: Array<{ def: SectionDef; rows: QueryResult[] }> = [];
    for (const def of SECTION_DEFS) {
      const requestLimit = def.cap + DISMISSAL_SLACK;
      const rawRows = def.ast
        ? (await this.queryExecution.execute(def.ast, ctx, undefined, requestLimit)).items
        : await this.fetchNeedsReply(workspaceId, userId, requestLimit);

      const notSuppressed = rawRows.filter((row) => !this.isSuppressed(row, def.key, dismissals, now));
      filteredBySection.push({ def, rows: notSuppressed.slice(0, def.cap) });
    }

    // Global noise budget (§2.7 "<=25 rows"), applied in the fixed section
    // order above: once the budget is spent, every later section truncates
    // to empty and is therefore dropped (§2.7 "sections render only when
    // non-empty").
    let budgetRemaining = GLOBAL_ROW_BUDGET;
    const sections: TriageSection[] = [];
    for (const { def, rows } of filteredBySection) {
      const take = Math.min(rows.length, budgetRemaining);
      budgetRemaining -= take;
      if (take === 0) continue;
      sections.push({
        key: def.key,
        title: def.title,
        description: def.description,
        ast: def.ast,
        items: rows.slice(0, take),
      });
    }

    const badge = await this.computeBadge(workspaceId, userId, sections);
    return { sections, badge };
  }

  /** Badge = count of rows in the FINAL section list newer than the caller's last-seen marker; if no marker exists yet, badge = total final rows (everything is "new"). */
  private async computeBadge(workspaceId: string, userId: string, sections: TriageSection[]): Promise<number> {
    const seen = await this.prisma.triageSeen.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    const allItems = sections.flatMap((s) => s.items);
    if (!seen) {
      return allItems.length;
    }
    const lastSeenAt = seen.lastSeenAt.getTime();
    return allItems.filter((item) => new Date(item.updatedAt).getTime() > lastSeenAt).length;
  }

  private async loadActiveDismissals(userId: string, now: Date): Promise<Map<string, DismissalRow>> {
    const rows = await this.prisma.triageDismissal.findMany({
      where: { userId, until: { gt: now } },
      select: { issueId: true, section: true, priorityAtDismiss: true, wasOverdueAtDismiss: true },
    });
    return new Map(rows.map((row) => [`${row.issueId}:${row.section}`, row]));
  }

  /**
   * A dismissed row stays suppressed UNLESS it escalated since the dismissal
   * was made: priority raised, or the issue became overdue while it was NOT
   * overdue at dismiss time. On escalation the row is shown again — the
   * dismissal row itself is never deleted (it just stops matching).
   */
  private isSuppressed(
    row: QueryResult,
    section: TriageSectionKey,
    dismissals: Map<string, DismissalRow>,
    now: Date,
  ): boolean {
    const dismissal = dismissals.get(`${row.id}:${section}`);
    if (!dismissal) return false;

    if (PRIORITY_RANK[row.priority] > PRIORITY_RANK[dismissal.priorityAtDismiss]) {
      return false; // priority raised since dismissal -> escalation, show again
    }

    const isOverdueNow = row.dueDate !== null && new Date(row.dueDate).getTime() <= now.getTime();
    if (isOverdueNow && !dismissal.wasOverdueAtDismiss) {
      return false; // became overdue since dismissal -> escalation, show again
    }

    return true;
  }

  /**
   * Bespoke NEEDS_REPLY rule (no AST representation — a comment-join, not a
   * filterable issue field): "I was @mentioned, I haven't commented since the
   * latest mention, issue not DONE". One parameterized `$queryRaw` (never
   * string-concatenated), then hydrated through the SAME `ISSUE_INCLUDE`/
   * `toQueryResult` the AST-backed sections use, preserving the SQL's
   * mentioned-at-DESC order.
   */
  private async fetchNeedsReply(workspaceId: string, userId: string, limit: number): Promise<QueryResult[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        WITH last_mention AS (
          SELECT c."issueId", MAX(c."createdAt") AS mentioned_at
          FROM "Comment" c
          WHERE ${userId} = ANY(c.mentions) AND c."authorId" <> ${userId}
          GROUP BY c."issueId"
        )
        SELECT i.id
        FROM last_mention lm
        JOIN "Issue" i ON i.id = lm."issueId"
        JOIN "Project" p ON p.id = i."projectId"
        WHERE p."workspaceId" = ${workspaceId}
          AND i.status <> 'DONE'
          AND NOT EXISTS (
            SELECT 1 FROM "Comment" mine
            WHERE mine."issueId" = i.id AND mine."authorId" = ${userId} AND mine."createdAt" > lm.mentioned_at
          )
        ORDER BY lm.mentioned_at DESC
        LIMIT ${limit}
      `,
    );

    if (rows.length === 0) {
      return [];
    }

    const ids = rows.map((r) => r.id);
    const issues = await this.prisma.issue.findMany({
      where: { id: { in: ids } },
      include: ISSUE_INCLUDE,
    });
    const byId = new Map(issues.map((issue) => [issue.id, issue]));

    return ids
      .map((id) => byId.get(id))
      .filter((issue): issue is IssueRow => issue !== undefined)
      .map(toQueryResult);
  }

  private async safeCacheGet(key: string): Promise<TriageResponse | null> {
    try {
      return await this.cache.get(key);
    } catch {
      return null;
    }
  }

  private async safeCacheSet(key: string, value: TriageResponse): Promise<void> {
    try {
      await this.cache.set(key, value, TRIAGE_CACHE_TTL_SECONDS);
    } catch {
      // Fail open — a cache-set failure must never fail the request that already computed a good result.
    }
  }

  private async safeCacheDel(key: string): Promise<void> {
    try {
      await this.cache.del(key);
    } catch {
      // Fail open — a stale-until-TTL cache entry is an acceptable degradation, not an error.
    }
  }
}
