# ADR-0006: Postgres Full-Text Search for MVP (No JQL)

## Status
Accepted — 2026-07-01

## Context
Jira's JQL is powerful but a real barrier for ordinary users — a differentiator for Workflo is fast, simple search with no query language to learn. We also don't want to run a separate search cluster at MVP.

## Decision
Use **PostgreSQL full-text search** (`tsvector` column on Issue + GIN index) for MVP search over title/description, combined with plain filters (assignee, label, status). Expose a single `q` param and simple filter params — **no JQL**. Keep search behind a dedicated `Search` module so the backend can be swapped later.

## Alternatives Considered
- **Elasticsearch / OpenSearch** — best relevance and scale, but heavy to run/operate; overkill for MVP.
- **Meilisearch / Typesense** — great DX and speed, but another service to run and sync.
- **Naive `ILIKE`** — trivial, but no ranking, poor performance at scale, no stemming.

## Consequences
- Positive: zero extra infrastructure; good-enough relevance with stemming and ranking; stays consistent with the DB (no sync lag).
- Positive: the `Search` module boundary makes a future swap to Meilisearch/Elastic clean.
- Negative: Postgres FTS relevance and typo-tolerance are weaker than dedicated engines (acceptable for MVP; revisit in phase 4).

## Trade-offs
Operational simplicity and consistency are prioritised over top-tier search relevance, which we defer.
