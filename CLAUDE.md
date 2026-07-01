# CLAUDE.md — Workflo Operating Manual

> This file is auto-loaded by Claude Code at the start of every session.
> It is the **single source of truth** for how work is done on Workflo.
> Claude MUST read the Progress Log before acting and MUST append to it after every meaningful step.

---

## 1. What Workflo Is

Workflo is a **Jira alternative** — the goal is to build a project/issue tracker that beats Jira on:
- **Speed** — instant, keyboard-first UI (Linear-style), no slow page loads.
- **Simplicity** — no JQL barrier, no heavy admin/permission schemes to configure.
- **Real-time** — live collaboration (presence, live board updates) built in from day one.
- **Low notification noise** — smart, filterable notifications.

We are NOT trying to replicate every Jira feature. We deliberately cut scope (see §5).

---

## 2. Tech Stack (locked)

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | **React 18 + TypeScript + Vite** | SPA. State: TanStack Query + Zustand. UI: keyboard-first. |
| Backend | **NestJS (Node + TypeScript)** | Modular monolith. |
| ORM | **Prisma** | Type-safe DB access. |
| Database | **PostgreSQL** | Primary datastore. Full-text search via Postgres FTS (no Elastic in MVP). |
| Cache / PubSub | **Redis** | Cache, Socket.IO adapter, BullMQ queues. |
| Real-time | **Socket.IO** | Redis adapter for horizontal scale. |
| Queues | **BullMQ** | Notifications, async automations. |
| Repo | **pnpm monorepo (Turborepo)** | `apps/web`, `apps/api`, `packages/shared`. |
| Shared types | **`packages/shared`** | Zod schemas + TS types shared FE/BE for end-to-end type safety. |

Full rationale in [docs/architecture.md](docs/architecture.md) and [docs/adr/](docs/adr/).

---

## 3. Model Routing (MANDATORY)

The user requires specific models for specific work. Follow this strictly.

| Work type | Model | How |
|-----------|-------|-----|
| **Planning, architecture, design decisions, ADRs, reviews, breaking down work** | **Fable 5** (`claude-fable-5`) by default; **Opus 4.8** (`claude-opus-4-8`) as fallback when Fable is unavailable | Do it in the main session. |
| **Writing/refactoring code ("dirty work")** | **Sonnet 5** (`claude-sonnet-5`) | Dispatch via the `Agent` tool with `model: "sonnet"`. Do not write feature code directly on Opus. |
| **Writing/running tests** | **Sonnet 5** (`claude-sonnet-5`) | Same — dispatch to a Sonnet agent. |

Rule of thumb: **Fable/Opus think, Sonnet types.** When it's time to implement a planned unit, spin a Sonnet subagent with a tight, self-contained brief (the plan is already done on the planning model).

---

## 4. Working Agreement (how Claude must behave)

1. **Read the Progress Log (§8) first.** Never re-decide something already decided; never redo done work.
2. **Log every meaningful step** in §8 with date + what changed + why. This is the "don't forget / don't mess up" contract.
3. **Plan on Opus, implement on Sonnet** (see §3).
4. **Small, verifiable steps.** One coherent change at a time; verify before moving on.
5. **Keep shared contracts in `packages/shared`.** FE and BE must never drift on types — change the Zod schema, both sides follow.
6. **Do not expand MVP scope** (§5) without the user explicitly approving. Park ideas in §7 Backlog.
7. **Ask before irreversible/outward-facing actions** (deploys, deleting data, public releases).
8. **Conventional Commits** for git messages. Branch off `main`; never commit straight to `main` for feature work once code exists.

---

## 5. MVP Scope (locked)

**In:**
- Auth: email/password + Google OAuth. Single workspace role model (owner/member).
- Workspace → Project → Issue data model. Issue types: Task, Bug (+ Epic as a lightweight grouping).
- Issue fields: title, description, status, assignee, reporter, priority, labels, due date.
- Fixed workflow: `To Do → In Progress → Done`.
- Kanban board with drag & drop (status change + rank ordering).
- Backlog / list view with filters.
- Issue detail page: comments + `@mentions`.
- **Real-time** updates over WebSocket (board, issue, comments, presence).
- Fast simple search (title/description/assignee) — **no JQL**.

**Deliberately OUT of MVP** (see roadmap phases 4–5):
Sprints & full Scrum mechanics · Epic-portfolio/Roadmap timeline · Automation rules · Custom workflows · GitHub/Slack integrations · Time tracking/worklogs · Service desk/SLA · SSO/audit logs/granular permission schemes · Attachments (may pull earlier if cheap).

---

## 6. Post-MVP Roadmap

1. **Private beta / dogfooding** — track Workflo's own dev inside Workflo.
2. **Public beta** (~10–50 users) — feedback + retention/time-to-action metrics.
3. **V1 release** — stabilize API, fix beta findings, add billing if monetizing.
4. **Differentiation features** — speed, keyboard-first UX, smart search (vs JQL), git integration, real-time collab.
5. **Scale / enterprise** — SSO, granular permissions, audit logs, external integrations.

---

## 7. Backlog / Parking Lot

_(Ideas that are out of current scope — do not build without approval.)_
- Sprints / Scrum boards
- Timeline / roadmap view
- Automation rules engine
- Attachments & rich media in comments

---

## 8. Progress Log (APPEND-ONLY — newest at bottom)

> Format: `YYYY-MM-DD — [PHASE] what changed — why / decision`

- **2026-07-01 — [SETUP]** Created GitHub repo `izumi101/Workflo` (public), initialized git, pushed initial commit to `main`.
- **2026-07-01 — [PLANNING]** Locked stack (React + NestJS + Postgres + Prisma + Redis), MVP scope, and post-MVP roadmap with user. Saved to memory.
- **2026-07-01 — [PLANNING]** Established model routing rule: Opus 4.8/Fable for planning, Sonnet 5 for code & tests.
- **2026-07-01 — [ARCHITECTURE]** Wrote full architecture: `CLAUDE.md`, `docs/architecture.md`, ADR-0001..0006, data model sketch, monorepo layout. Used `architecture-designer` skill. No implementation code yet (deferred to Sonnet).
- **2026-07-01 — [PLANNING]** Model routing clarified by user: **Fable 5 is the default planner, Opus 4.8 is fallback** when Fable is unavailable. Updated §3 + memory. Decided NOT to run `ln-100-documents-pipeline` now (overlaps/would overwrite these docs; revisit at beta with a tracker).
- **2026-07-01 — [ARCHITECTURE]** Presented container architecture diagram to user for review before scaffolding. Awaiting go-ahead to scaffold.
- **2026-07-01 — [SCAFFOLD]** Scaffolded pnpm+turbo monorepo: packages/shared (zod schemas), apps/api (NestJS + Prisma schema + /api/v1/health), apps/web (Vite+React+TanStack Query, health round-trip). Verified: pnpm install, shared build/typecheck, `prisma validate`, api build, web build, root `pnpm build`/`pnpm typecheck` via turbo, and a live boot of the API (`PORT=3099`) returning 200 from `GET /api/v1/health` with no DB/Redis running.

_Next up: implement the Auth module (email/password + Google OAuth, JWT access/refresh) per ADR-0005 — implement via Sonnet 5, pending user approval._
