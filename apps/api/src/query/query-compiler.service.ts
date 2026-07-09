import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Priority, QueryWarning, RelativeRange, WorkfloQuery } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * Execution context resolved by the caller (controller) from the
 * JWT-authenticated user + WorkspaceMemberGuard — NEVER from the AST. See
 * `compileQuery`'s doc comment for why this is the whole security surface.
 */
export interface CompileContext {
  workspaceId: string;
  userId: string;
  now: Date;
  /**
   * Caller's local UTC offset in minutes (e.g. UTC-5 => -300). v1a's
   * relative-range resolution ("last N days") is pure duration math from
   * `now` — timezone-invariant under a fixed offset — so this isn't
   * currently consumed by any date computation below. It's accepted here
   * for interface stability with a future calendar-boundary-aware
   * resolution (e.g. "due today" aligned to the caller's local midnight
   * rather than a rolling 24h window — see query-parse.ts's doc comment on
   * that approximation).
   */
  tzOffsetMinutes: number;
}

/**
 * `"rank"` is a sentinel meaning "order by FTS relevance" — not a real
 * Prisma orderBy, since `ts_rank` is a computed raw-SQL value, not a
 * persisted/sortable column. Only ever returned when `ftsTerm` is set (see
 * `compileOrderBy`); the execution layer (QueryExecutionService) is
 * responsible for handling it via the ranked-id-array path.
 */
export type CompiledOrderBy = Prisma.IssueOrderByWithRelationInput[] | "rank";

export interface CompiledQuery {
  where: Prisma.IssueWhereInput;
  ftsTerm?: string;
  orderBy: CompiledOrderBy;
  warnings: QueryWarning[];
}

const PRIORITY_ORDER: readonly Priority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

function priorityAtLeast(min: Priority): Priority[] {
  const idx = PRIORITY_ORDER.indexOf(min);
  // idx is always found (min is a validated Priority enum value); slice
  // defensively from 0 if somehow not found rather than throwing.
  return PRIORITY_ORDER.slice(idx === -1 ? 0 : idx);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Compiles a `WorkfloQuery` AST (packages/shared/src/query.ts) into a Prisma
 * `where`/`orderBy` — reusing the existing `fts.ts` + id-prefilter pattern
 * (see `IssuesService.listByProject`/`SearchService.search`), never a new
 * search engine (docs/design/nlq-search.md §3.2).
 *
 * SECURITY SURFACE — the compiler invariants (§3.2, and the direct
 * application of the 2026-07-04 issue-key-collision lesson, CLAUDE.md §8):
 *  1. `where` ALWAYS begins with the server-supplied `project: {workspaceId}`
 *     scope (from `ctx.workspaceId`, resolved by `WorkspaceMemberGuard`
 *     BEFORE this method is ever called) — never from the AST, which has no
 *     workspace field at all (see query.ts's file header). A foreign
 *     workspace's id appearing anywhere else in the AST can therefore never
 *     widen the result set beyond the caller's own workspace.
 *  2. Every id the AST names (project.in, assignee/reporter .in, labels)
 *     is validated to belong to `ctx.workspaceId` before compiling. An
 *     invalid/foreign id is DROPPED from its clause (not the caller's whole
 *     query) and recorded as an `invalid_id` warning — never a 500, never a
 *     silent wrong-workspace result. If every id in a clause is invalid,
 *     the whole clause is dropped (equivalent to it never having been
 *     specified) rather than compiling to an always-false filter that
 *     could be confused with "explicitly filtered to nothing".
 *  3. Free text only ever reaches SQL via `Prisma.sql` parameters through
 *     `fts.ts` (`issueFtsMatch`/`issueFtsRank`) — no string concatenation,
 *     no new raw-SQL surface introduced here (see QueryExecutionService).
 *  4. `assignee: "unassigned"` compiles to `assigneeId: null` exactly (the
 *     backend support the 2026-07-04 backlog session flagged as missing).
 */
@Injectable()
export class QueryCompilerService {
  constructor(private readonly prisma: PrismaService) {}

  async compileQuery(ast: WorkfloQuery, ctx: CompileContext): Promise<CompiledQuery> {
    const warnings: QueryWarning[] = [];
    const conditions: Prisma.IssueWhereInput[] = [
      // Invariant 1 — always first, always server-supplied.
      { project: { workspaceId: ctx.workspaceId } },
    ];

    if (ast.project) {
      const validIds = await this.filterProjectIds(ast.project.in, ctx.workspaceId, warnings);
      if (validIds.length > 0) {
        conditions.push({ projectId: { in: validIds } });
      }
    }

    if (ast.type) {
      conditions.push({ type: { in: ast.type.in } });
    }

    if (ast.status) {
      if ("in" in ast.status) {
        conditions.push({ status: { in: ast.status.in } });
      } else {
        conditions.push({ status: { not: "DONE" } });
      }
    }

    if (ast.priority) {
      if ("in" in ast.priority) {
        conditions.push({ priority: { in: ast.priority.in } });
      } else {
        conditions.push({ priority: { in: priorityAtLeast(ast.priority.atLeast) } });
      }
    }

    if (ast.assignee) {
      if (ast.assignee === "me") {
        conditions.push({ assigneeId: ctx.userId });
      } else if (ast.assignee === "unassigned") {
        // Invariant 4.
        conditions.push({ assigneeId: null });
      } else {
        const validIds = await this.filterMemberIds("assignee", ast.assignee.in, ctx.workspaceId, warnings);
        if (validIds.length > 0) {
          conditions.push({ assigneeId: { in: validIds } });
        }
      }
    }

    if (ast.reporter) {
      if (ast.reporter === "me") {
        conditions.push({ reporterId: ctx.userId });
      } else {
        const validIds = await this.filterMemberIds("reporter", ast.reporter.in, ctx.workspaceId, warnings);
        if (validIds.length > 0) {
          conditions.push({ reporterId: { in: validIds } });
        }
      }
    }

    if (ast.labels) {
      if ("any" in ast.labels) {
        const validIds = await this.filterLabelIds(ast.labels.any, ctx.workspaceId, warnings);
        if (validIds.length > 0) {
          conditions.push({ labels: { some: { id: { in: validIds } } } });
        }
      } else {
        const validIds = await this.filterLabelIds(ast.labels.all, ctx.workspaceId, warnings);
        // "has ALL of these labels" — one `some: {id}` clause per label,
        // ANDed together (Prisma has no native "relation contains every one
        // of these specific ids" filter; `every` means something different
        // — "every related row matches", not "every named id is present").
        for (const id of validIds) {
          conditions.push({ labels: { some: { id } } });
        }
      }
    }

    if (ast.due) {
      if ("overdue" in ast.due) {
        conditions.push({ dueDate: { lt: ctx.now } });
        conditions.push({ status: { not: "DONE" } });
      } else {
        conditions.push({ dueDate: this.buildRangeFilter(ast.due, ctx.now, "future") });
      }
    }
    if (ast.updated) {
      conditions.push({ updatedAt: this.buildRangeFilter(ast.updated, ctx.now, "past") });
    }
    if (ast.created) {
      conditions.push({ createdAt: this.buildRangeFilter(ast.created, ctx.now, "past") });
    }

    const where: Prisma.IssueWhereInput = { AND: conditions };
    const ftsTerm = ast.text && ast.text.trim().length > 0 ? ast.text.trim() : undefined;
    const orderBy = this.compileOrderBy(ast.order, !!ftsTerm);

    return { where, ftsTerm, orderBy, warnings };
  }

  /**
   * `withinDays`/`olderThanDays`/`between` -> a plain `{gte?,lte?,lt?}`
   * range object, usable as the value for either a nullable (`dueDate`) or
   * non-null (`updatedAt`/`createdAt`) DateTime filter — both accept the
   * same `{gte,lte,lt}` shape structurally.
   *
   * `direction` governs which way `withinDays` looks from `now`:
   *  - "future" (due): [now, now+N days] — "due soon".
   *  - "past" (updated/created): [now-N days, now] — "touched recently".
   * `olderThanDays` is always backward from `now` regardless of direction
   * (due: "overdue by more than N days"; updated/created: "stale").
   */
  private buildRangeFilter(
    range: RelativeRange,
    now: Date,
    direction: "past" | "future",
  ): { gte?: Date; lte?: Date; lt?: Date } {
    if ("between" in range) {
      return { gte: new Date(range.between[0]), lte: new Date(range.between[1]) };
    }
    if ("withinDays" in range) {
      return direction === "future"
        ? { gte: now, lte: addDays(now, range.withinDays) }
        : { gte: addDays(now, -range.withinDays), lte: now };
    }
    return { lt: addDays(now, -range.olderThanDays) };
  }

  /**
   * Ranking (docs/design/nlq-search.md §2.5): text present -> FTS relevance
   * (handled by the execution layer via the ranked-id path, signaled here
   * by the `"rank"` sentinel); no text -> deterministic "work order"
   * (priority desc, dueDate asc nulls-last, updatedAt desc); ties broken on
   * `id`. An explicit AST `order` (anything but `"smart"`/unset) always
   * overrides both defaults.
   */
  private compileOrderBy(order: WorkfloQuery["order"], hasText: boolean): CompiledOrderBy {
    const effective = order && order !== "smart" ? order : hasText ? "rank" : "smart";
    switch (effective) {
      case "rank":
        return "rank";
      case "updated":
        return [{ updatedAt: "desc" }, { id: "desc" }];
      case "created":
        return [{ createdAt: "desc" }, { id: "desc" }];
      case "due":
        return [{ dueDate: { sort: "asc", nulls: "last" } }, { id: "desc" }];
      case "priority":
        return [{ priority: "desc" }, { id: "desc" }];
      case "smart":
      default:
        return [
          { priority: "desc" },
          { dueDate: { sort: "asc", nulls: "last" } },
          { updatedAt: "desc" },
          { id: "desc" },
        ];
    }
  }

  private async filterProjectIds(ids: string[], workspaceId: string, warnings: QueryWarning[]): Promise<string[]> {
    const rows = await this.prisma.project.findMany({
      where: { id: { in: ids }, workspaceId },
      select: { id: true },
    });
    return this.dropInvalid("project", ids, new Set(rows.map((r) => r.id)), warnings);
  }

  private async filterMemberIds(
    field: "assignee" | "reporter",
    ids: string[],
    workspaceId: string,
    warnings: QueryWarning[],
  ): Promise<string[]> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId: { in: ids }, workspaceId },
      select: { userId: true },
    });
    return this.dropInvalid(field, ids, new Set(rows.map((r) => r.userId)), warnings);
  }

  private async filterLabelIds(ids: string[], workspaceId: string, warnings: QueryWarning[]): Promise<string[]> {
    const rows = await this.prisma.label.findMany({
      where: { id: { in: ids }, project: { workspaceId } },
      select: { id: true },
    });
    return this.dropInvalid("labels", ids, new Set(rows.map((r) => r.id)), warnings);
  }

  /**
   * Invariant 2 — keeps only ids present in `validSet`; any id NOT in the
   * workspace is dropped from its clause and recorded as an `invalid_id`
   * warning (never widens scope, never throws).
   */
  private dropInvalid(
    field: string,
    requested: string[],
    validSet: Set<string>,
    warnings: QueryWarning[],
  ): string[] {
    const valid = requested.filter((id) => validSet.has(id));
    const invalid = requested.filter((id) => !validSet.has(id));
    if (invalid.length > 0) {
      warnings.push({ field, kind: "invalid_id", ids: invalid });
    }
    return valid;
  }
}
