# ADR-0002: PostgreSQL + Prisma as Datastore and ORM

## Status
Accepted — 2026-07-01

## Context
Workflo's core domain (workspaces, projects, issues, comments, labels, memberships) is highly relational with strong consistency needs — an issue's status change, rank, and human key must be transactionally correct.

## Decision
Use **PostgreSQL** as the primary datastore and **Prisma** as the ORM. Use Postgres full-text search for MVP search (see ADR-0006).

## Alternatives Considered
- **MongoDB** — flexible schema, but weak multi-document ACID and awkward for relational queries (issue ↔ project ↔ labels ↔ comments).
- **MySQL** — viable, but Postgres has richer features we want (FTS, `tsvector`, JSONB, arrays for mentions/labels).
- **TypeORM / Drizzle instead of Prisma** — TypeORM has weaker type safety; Drizzle is leaner but Prisma's migrations + generated client + DX win for a small team.

## Consequences
- Positive: strong consistency, transactions, mature tooling, built-in FTS and JSONB.
- Positive: Prisma gives type-safe queries and first-class migrations.
- Negative: Prisma adds a generation step and some query-shape limitations for very complex queries (escape hatch: raw SQL).

## Trade-offs
Consistency, relational query power, and developer DX are prioritised over the schema flexibility of a document store, which we don't need.
