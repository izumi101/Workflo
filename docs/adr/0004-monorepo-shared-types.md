# ADR-0004: pnpm Monorepo with a Shared Types/Schema Package

## Status
Accepted — 2026-07-01

## Context
The biggest source of bugs in a FE/BE split is contract drift — the frontend and backend disagreeing on a payload shape. Both sides are TypeScript, so we can share the contract instead of duplicating it.

## Decision
Use a **pnpm monorepo** managed by **Turborepo** with:
- `apps/web` — React frontend
- `apps/api` — NestJS backend
- `packages/shared` — **Zod schemas** (single source of truth) that export both runtime validators and inferred TS types, consumed by both apps.

The backend validates requests with these Zod schemas; the frontend uses the same schemas for form validation and the inferred types for API calls.

## Alternatives Considered
- **tRPC** — excellent end-to-end type safety, but pulls us away from idiomatic NestJS REST and complicates non-TS/public API consumers later.
- **OpenAPI + generated client** — solid, but adds a codegen pipeline and the generated types lag the source of truth.
- **Two separate repos** — simplest to reason about per repo, but guarantees drift and duplicate type definitions.

## Consequences
- Positive: one definition of every contract; a schema change breaks the build on both sides immediately.
- Positive: shared lint/tsconfig, atomic cross-cutting commits.
- Negative: monorepo tooling overhead (pnpm workspaces, Turbo cache) and slightly more complex CI.

## Trade-offs
Contract safety and DX are prioritised over the isolation of separate repos.
