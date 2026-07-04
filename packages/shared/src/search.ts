import { z } from "zod";
import { issueStatusSchema, prioritySchema } from "./enums.js";

/**
 * Global search — "fast search, no JQL" (ADR-0006). Query params for
 * `GET /api/v1/search`. `q` is a free-text search term fed to Postgres
 * `websearch_to_tsquery` server-side (tolerates arbitrary user input, never
 * throws) — NOT a query language; there is no filter syntax to learn.
 */
export const searchQuerySchema = z.object({
  q: z.string().max(255).optional().default(""),
  workspaceId: z.string().cuid(),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * Lightweight search result row — enough for the UI to render a result and
 * link to `/issues/:key` without a second round-trip. Deliberately NOT the
 * full `Issue` shape (no description, labels, etc.) to keep the endpoint fast.
 */
export const searchResultSchema = z.object({
  id: z.string().cuid(),
  key: z.string(),
  title: z.string(),
  status: issueStatusSchema,
  priority: prioritySchema,
  projectId: z.string().cuid(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const searchResponseSchema = z.object({
  items: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;
