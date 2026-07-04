import { Prisma } from "@prisma/client";

/**
 * Shared Postgres full-text search helpers (ADR-0006). Match the functional
 * GIN index created in migration `20260704052638_search_fts`:
 *   CREATE INDEX "Issue_fts_idx" ON "Issue"
 *     USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,'')));
 *
 * `websearch_to_tsquery` (rather than `plainto_tsquery`/`to_tsquery`) tolerates
 * arbitrary user input (quotes, "-", "or", stray punctuation) without ever
 * throwing a syntax error, which is what makes it safe to feed straight from
 * a search box. Always used via `Prisma.sql` tagged templates below — `q` is
 * NEVER string-concatenated into raw SQL (injection).
 *
 * `alias` lets the same helpers be reused whether querying the bare `Issue`
 * table (no alias needed) or a joined query using a table alias (e.g. `i` in
 * `FROM "Issue" i INNER JOIN "Project" p ...`, as the cross-project global
 * search does).
 */
function qualify(alias: string | undefined, column: string): Prisma.Sql {
  return alias ? Prisma.raw(`"${alias}"."${column}"`) : Prisma.raw(`"${column}"`);
}

function tsvectorExpr(alias?: string): Prisma.Sql {
  return Prisma.sql`to_tsvector('english', coalesce(${qualify(alias, "title")},'') || ' ' || coalesce(${qualify(alias, "description")},''))`;
}

/** FTS match predicate — use in a WHERE clause. */
export function issueFtsMatch(q: string, alias?: string): Prisma.Sql {
  return Prisma.sql`${tsvectorExpr(alias)} @@ websearch_to_tsquery('english', ${q})`;
}

/** Relevance ranking expression matching the same predicate — use in ORDER BY. */
export function issueFtsRank(q: string, alias?: string): Prisma.Sql {
  return Prisma.sql`ts_rank(${tsvectorExpr(alias)}, websearch_to_tsquery('english', ${q}))`;
}
