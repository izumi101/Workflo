import { workfloQuerySchema, type WorkfloQuery } from "@workflo/shared";

/** `?q=<url-encoded AST JSON>` — the shareable-URL contract for `/views/new` (§2.5). */
export function encodeAstForUrl(ast: WorkfloQuery): string {
  return encodeURIComponent(JSON.stringify(ast));
}

/** Never throws — an invalid/missing/tampered `q` param degrades to an empty AST rather than a crashed page. */
export function decodeAstFromUrl(q: string | null): WorkfloQuery {
  if (!q) return { v: 1 };
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(q));
    const result = workfloQuerySchema.safeParse(parsed);
    return result.success ? result.data : { v: 1 };
  } catch {
    return { v: 1 };
  }
}
