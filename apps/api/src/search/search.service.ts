import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { SearchQuery, SearchResult } from "@workflo/shared";
import { PrismaService } from "../prisma/prisma.service.js";
import { issueFtsMatch, issueFtsRank } from "../common/fts.js";

/** Raw row shape returned by the ranked cross-project FTS query below. */
interface SearchRow {
  id: string;
  title: string;
  status: "TODO" | "IN_PROGRESS" | "DONE";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  projectId: string;
  projectKey: string;
  number: number;
}

function toSearchResult(row: SearchRow): SearchResult {
  return {
    id: row.id,
    key: `${row.projectKey}-${row.number}`,
    title: row.title,
    status: row.status,
    priority: row.priority,
    projectId: row.projectId,
  };
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Global search — the "fast search, no JQL" differentiator (ADR-0006).
   * Searches issue title/description via Postgres FTS across ALL projects in
   * `workspaceId`, ranked by `ts_rank` desc then `updatedAt` desc, capped at
   * `query.limit` (schema-clamped to 1-50, default 20). Blank/whitespace `q`
   * returns an empty result set without ever hitting the DB (don't error, and
   * don't return "everything" for an empty query — that's not what a search
   * box should do).
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    const q = query.q.trim();
    if (q.length === 0) {
      return [];
    }

    const rows = await this.prisma.$queryRaw<SearchRow[]>(
      Prisma.sql`
        SELECT
          i."id" AS "id",
          i."title" AS "title",
          i."status" AS "status",
          i."priority" AS "priority",
          i."projectId" AS "projectId",
          p."key" AS "projectKey",
          i."number" AS "number"
        FROM "Issue" i
        INNER JOIN "Project" p ON p."id" = i."projectId"
        WHERE p."workspaceId" = ${query.workspaceId}
          AND ${issueFtsMatch(q, "i")}
        ORDER BY ${issueFtsRank(q, "i")} DESC, i."updatedAt" DESC
        LIMIT ${query.limit}
      `,
    );

    return rows.map(toSearchResult);
  }
}
