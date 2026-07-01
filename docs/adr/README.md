# Architecture Decision Records

Each ADR captures one significant decision, its context, the alternatives weighed, and the trade-off. Newest decisions supersede older ones by adding a new ADR (we don't rewrite history).

| ADR | Decision | Status |
|-----|----------|--------|
| [0001](0001-modular-monolith.md) | Modular monolith over microservices | Accepted |
| [0002](0002-postgres-prisma.md) | PostgreSQL + Prisma | Accepted |
| [0003](0003-realtime-socketio-redis.md) | Socket.IO + Redis adapter for real-time | Accepted |
| [0004](0004-monorepo-shared-types.md) | pnpm monorepo + shared Zod/types package | Accepted |
| [0005](0005-auth-jwt-oauth.md) | JWT access/refresh + Google OAuth | Accepted |
| [0006](0006-search-postgres-fts.md) | Postgres FTS for search (no JQL) | Accepted |

Template: Status · Context · Decision · Alternatives Considered · Consequences · Trade-offs.
