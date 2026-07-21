import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { QueryResult, WorkfloQuery } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { issueFtsMatch, issueFtsRank } from "../common/fts.js";
import { QueryCompilerService, type CompileContext } from "./query-compiler.service.js";

export interface QueryExecuteResult {
  items: QueryResult[];
  nextCursor: string | null;
}

/** Raw ids matched by FTS are capped generously — v1a doesn't attempt a
 * fully rank-aware DB-level keyset cursor (ts_rank isn't a persisted,
 * sortable column); see `executeRankOrdered`'s doc comment. This cap bounds
 * both the raw query and the JS-side re-sort/pagination work it feeds. */
const FTS_CANDIDATE_CAP = 1000;

const ISSUE_INCLUDE = {
  labels: { select: { id: true } },
  project: { select: { key: true } },
} as const;

type IssueRow = Prisma.IssueGetPayload<{ include: typeof ISSUE_INCLUDE }>;

function toQueryResult(row: IssueRow): QueryResult {
  return {
    id: row.id,
    key: `${row.project.key}-${row.number}`,
    title: row.title,
    status: row.status,
    priority: row.priority,
    projectId: row.projectId,
    assigneeId: row.assigneeId,
    dueDate: row.dueDate,
    updatedAt: row.updatedAt,
    labelIds: row.labels.map((l) => l.id),
    type: row.type,
  };
}

/**
 * Executes a compiled `WorkfloQuery` — mirrors `IssuesService.listByProject`
 * exactly (docs/design/nlq-search.md §3.2): if the AST carries a `text`
 * clause, resolve matching ids via the existing `fts.ts` helpers through one
 * workspace-scoped `$queryRaw` (same join-to-Project pattern as
 * `SearchService.search`), then feed `{id: {in: ids}}` into `findMany` with
 * the compiled `where`. Otherwise, plain `findMany` with `where`+`orderBy`+
 * native cursor, same as the existing per-project issue list.
 */
@Injectable()
export class QueryExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compiler: QueryCompilerService,
  ) {}

  async execute(
    ast: WorkfloQuery,
    ctx: CompileContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<QueryExecuteResult> {
    const compiled = await this.compiler.compileQuery(ast, ctx);

    if (!compiled.ftsTerm) {
      // No text clause -> orderBy is guaranteed to be a real Prisma
      // orderBy array (compileOrderBy only ever returns the "rank"
      // sentinel when a text term is present).
      return this.executeStandard(compiled.where, compiled.orderBy as Prisma.IssueOrderByWithRelationInput[], cursor, limit);
    }

    const rankedIds = await this.findMatchingIssueIds(ctx.workspaceId, compiled.ftsTerm);
    if (rankedIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    if (compiled.orderBy === "rank") {
      return this.executeRankOrdered(compiled.where, rankedIds, cursor, limit);
    }

    // An explicit AST `order` overrides rank-by-relevance even with a text
    // clause present — the text still narrows via FTS, it just doesn't
    // drive the sort. Plain id-prefilter + compiled where + DB orderBy +
    // native cursor, same shape as the no-text path.
    const where: Prisma.IssueWhereInput = { AND: [compiled.where, { id: { in: rankedIds } }] };
    return this.executeStandard(where, compiled.orderBy, cursor, limit);
  }

  private async executeStandard(
    where: Prisma.IssueWhereInput,
    orderBy: Prisma.IssueOrderByWithRelationInput[],
    cursor: string | undefined,
    limit: number,
  ): Promise<QueryExecuteResult> {
    const rows = await this.prisma.issue.findMany({
      where,
      include: ISSUE_INCLUDE,
      orderBy,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;
    return { items: items.map(toQueryResult), nextCursor };
  }

  /**
   * Text-ranked path: `ts_rank` is a computed raw-SQL value, not a
   * persisted/indexed column, so there's no native DB-level keyset cursor
   * for it. Instead: fetch the full (capped) set of matching+ranked ids in
   * one raw query, re-fetch the subset that also satisfies the compiled
   * `where` (status/assignee/etc.) via one `findMany`, restore rank order
   * in application code (the candidate set is capped and therefore small),
   * then paginate by finding the cursor id's position in that ordered
   * list and slicing after it. If a cursor id is no longer present (data
   * changed since the previous page, or a stale cursor), this stops rather
   * than risk duplicating or skipping rows — an acceptable v1a trade-off
   * (documented follow-up: a true rank-aware keyset for scale).
   */
  private async executeRankOrdered(
    where: Prisma.IssueWhereInput,
    rankedIds: string[],
    cursor: string | undefined,
    limit: number,
  ): Promise<QueryExecuteResult> {
    const rows = await this.prisma.issue.findMany({
      where: { AND: [where, { id: { in: rankedIds } }] },
      include: ISSUE_INCLUDE,
    });

    const byId = new Map(rows.map((row) => [row.id, row]));
    const ordered = rankedIds
      .map((id) => byId.get(id))
      .filter((row): row is IssueRow => row !== undefined);

    let startIndex = 0;
    if (cursor) {
      const idx = ordered.findIndex((row) => row.id === cursor);
      if (idx === -1) {
        return { items: [], nextCursor: null };
      }
      startIndex = idx + 1;
    }

    const page = ordered.slice(startIndex, startIndex + limit + 1);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(0, limit) : page;
    const nextCursor = hasMore ? items[items.length - 1]!.id : null;
    return { items: items.map(toQueryResult), nextCursor };
  }

  /**
   * Resolves ids of issues in `workspaceId` (across all its projects, like
   * `SearchService.search`'s join) matching `q` via Postgres FTS, ordered
   * by relevance. `q` reaches SQL only through `Prisma.sql` params via
   * `issueFtsMatch`/`issueFtsRank` (compiler invariant 3) — never
   * string-concatenated.
   */
  private async findMatchingIssueIds(workspaceId: string, q: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        SELECT i."id" AS "id"
        FROM "Issue" i
        INNER JOIN "Project" p ON p."id" = i."projectId"
        WHERE p."workspaceId" = ${workspaceId}
          AND ${issueFtsMatch(q, "i")}
        ORDER BY ${issueFtsRank(q, "i")} DESC, i."updatedAt" DESC, i."id" DESC
        LIMIT ${FTS_CANDIDATE_CAP}
      `,
    );
    return rows.map((r) => r.id);
  }
}
