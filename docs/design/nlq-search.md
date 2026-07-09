# Workflo NLQ — Natural-Language Search + Smart Triage

> Flagship post-MVP differentiator (Phase-4 bet, pulled forward). **Designed on Fable 5** (2026-07-04). This is the source-of-truth design spec; implementers file deviations against it rather than re-litigating in-branch. Implement on Sonnet 5 (the 3 hard briefs — compiler, parse service, command-bar state machine — are Opus-authored first), Opus verifies.

Positioning: Jira ships a query language (JQL); Workflo ships a search box that understands you and **shows its work**.

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| Entry point | One surface: a **⌘K command bar** overlay. Replaces the top-bar `GlobalSearch` dropdown (top-bar input becomes the button that opens it). No split between "quick search" and "power search". |
| Core model | NL text resolves into an **editable chip rail** backed by a shared, versioned **`WorkfloQuery` AST** (Zod, in `packages/shared`). Chips ⇄ AST is bijective. The AST — not the sentence — is the source of truth after interpretation. |
| LLM in the loop | **Two lanes.** Lane A: deterministic parser + existing Postgres FTS on every keystroke, <150 ms, zero LLM. Lane B: Claude (`claude-haiku-4-5`, strict structured outputs) only on Enter with unresolved residual text, never blocking Lane A. LLM down ⇒ product still works. |
| Boolean power | **Conjunction-only AST in v1** (AND of clauses; IN-lists give per-field OR). No nested boolean trees. Keeps chips honest, compilation trivial, strict LLM schema expressible. OR-groups are a versioned extension, gated on dogfooding demand. |
| Saved power | **Views** = named, stored ASTs (never NL). Live, shareable, pinned to a new slim left rail. `assignee: me` stays symbolic — a shared view reads "assigned to me" per viewer. |
| Triage | Per-user **Triage** surface at `/triage`: 4 rule-based sections (canned ASTs + 1 bespoke SQL rule), computed **on demand** (no scheduled jobs in v1), dismissals + hard caps for low noise. LLM digest is v2. |
| Execution | AST compiles to the **existing** Prisma `where` + `fts.ts` id-prefilter pattern. No new search engine. Workspace scoping injected by the compiler, never taken from the AST. |
| Cost | Deterministic-first + Redis NL→AST cache + Haiku + prompt caching. ~$0.002/uncached parse; most searches never reach the LLM. Per-workspace daily budget with graceful degrade. |

---

## 1. Concept & positioning

**Pitch.** In Jira, power search means learning JQL — its own syntax, docs, and a wall between casual and power users. In Workflo you type what you mean: *"high-priority bugs assigned to me, untouched for a week."* The sentence resolves — visibly, in under a second — into four removable chips: `type: Bug` · `priority: High+` · `assignee: me` · `updated: >7d ago`. Results are already there. Tweak a chip if we got one wrong, press ⌘S, it's a live view forever. Nothing to learn, nothing hidden, nothing to trust blindly. And before you ask, **Triage** already collected what needs attention — overdue, stale, unanswered, unowned-but-urgent — with a dismiss that stays dismissed.

**Why it beats JQL:** (1) zero syntax floor — the first sentence works; (2) no glass ceiling — the chips *are* the power interface; (3) transparent not oracular — every AI interpretation is deterministic editable filters, so "it returned something, I don't know why" is structurally impossible; (4) compounding — chips → saved views → triage all run on one query model (Jira needs three systems).

**Aha (the demo):** ⌘K → type the sentence → Enter → chips materialize with one subtle pulse, 4 ranked results → ↓ Enter, on the issue → ⌘K, ⌘S, name "My stale urgents" → in the left rail, live, forever. ~15s, no docs needed.

---

## 2. Interaction & UX

### 2.1 Entry point — the ⌘K command bar
One overlay, opened by **⌘K** (and **/** when focus isn't in a text field), or by clicking the top-bar affordance styled like an input (`Search or filter…  ⌘K`). The existing `GlobalSearch` dropdown is retired; short filter-free queries still behave like today's quick-jump (FTS top hits, Enter opens the issue). 720px, centered, top-third, same surface recipe as `.global-search__dropdown`. Scope = active workspace (`active-workspace.store.ts`); a `project:` chip narrows.

### 2.2 Two-lane input (latency perception is the design)
- **Lane A — every keystroke (250 ms debounce):** the deterministic parser (shared, client-side, zero network) turns recognized fragments into provisional chips; the remainder is the FTS text term; provisional AST executes via `POST /query/execute`, <150 ms. For "drag ghost", Lane A is the whole experience.
  - Grammar (closed, tested, shared — `query-parse.ts`) covers ~70%: `assigned to me/my…`, `@Name`/bare names, `unassigned`, `reported by X`, priority words (`urgent`,`p1`,`high+`), type words, status words (`open`=not DONE, etc.), `overdue`, `due today/this week/before <date>`, `updated/created in last N days`, `stale`/`untouched` (updated >7d), project names/keys, labels, `sort by…`.
- **Lane B — Claude, only on commitment:** Enter with unresolved residual text (>2 words or contains intent vocab) fires `POST /query/parse`. A single **ghost chip** (`⟳ interpreting…`) is the only spinner. On return (~300–1200 ms; instant on Redis hit) new chips slide in with one ~200 ms pulse, the sentence collapses out, results re-execute once. Enter with nothing unresolved = open top result (nav intent), no LLM.
- Race handling: each parse carries a request id; stale responses discarded. One reducer owns chip/result state; LLM can only add/replace chips through a single transition.
- After interpretation the sentence is gone; chips are the query. v1 refinements are **additive** (further text → more chips). Conversational *mutation* is v2.

### 2.3 Chips
Chip = field icon + `field: value` + `×`; every chip ⇄ one AST clause (the transparency invariant). States: **Firm** (solid), **Tentative** (dashed + `?`, filters using the top candidate but legible/correctable), **Text** (`contains: "…"`, the FTS term — nothing typed is ever silently dropped). Editing a chip opens an anchored popover with the field-appropriate control (member filter list, enum list, label multi-select, relative-date presets 24h/3d/7d/30d/custom). **Chip edits never call the LLM** — pure AST edit → immediate re-execute. Keyboard extends the shipped `GlobalSearch`/`NotificationBell` combobox conventions: ⌘K/`/` open, Esc close+clear, ↑↓ result highlight, Enter open, ⌘Enter open-as-view, Tab→rail, ←→ between chips, Backspace at pos 0 focuses last chip, ⌘S save. Rail `role="toolbar"`.

### 2.4 Ambiguity — never guess silently, never block
- **Entity** (two Sarahs): unique match → firm; multiple → tentative (top candidate by recent activity, Enter shows list); zero → text chip.
- **Field** ("Sarah's bugs"): fixed default **assignee** ("reported/filed/created by" → reporter); chip field-name is the one-click swap; both parser lanes coded to the same rule.
- **Unmappable** ("flaky test stuff from standup"): stays in the text chip, marked `unmapped`, no error/modal.
- No "AI confidence score" UI — trust comes from inspectability.

### 2.5 Results
Bar: top 8, dense single-line rows (backlog-table recipe) with a **query-adaptive context column** (date/assignee/updated per what the AST filters on). Full page: ⌘Enter → `/views/new?q=<AST>` (generalized `BacklogPage`: chip rail + full columns + cursor "Load more"), URL-shareable; saved views at `/views/:id`.
Ranking (deterministic): text present → `ts_rank DESC, updatedAt DESC`; no text → **work order** `priority DESC, dueDate ASC NULLS LAST, updatedAt DESC`; AST `order` field (`smart` default + updated/created/due/priority); ties break on `id`.
States: no result-area spinner (only the ghost chip); empty = "No issues match" + chip rail + "Remove last filter"/"Search everywhere for '<text>'"; LLM degraded = quiet footer "Filtered literally — smart interpretation unavailable"; execute error = `.global-search__status` + Retry.

### 2.6 Saved Views — power without JQL
⌘S anywhere the chip rail exists; one field (name); scope Personal (default)/Workspace (OWNER-or-creator edits workspace views). Stores `{name, ast, scope, pinned}` — **never the NL**. Live by construction (relative clauses + `me` re-resolve per execution/viewer). Home = a new **slim left rail** (~220px, collapsible, existing tokens): **Triage** (count badge, `notif-bell__badge` recipe) · **Views** (pinned then recent) · **Projects**. Seeded defaults per user: "Assigned to me", "Reported by me", "Due this week" (double as onboarding). Realtime: v1 = focus-refetch + 30 s staleTime; v1.5 = `workspace:{id}` socket room (same membership-checked join as `project:{id}`).

### 2.7 Smart Triage — attention without asking
`/triage`, per-user, workspace-scoped, meant to be empty. Sections (each = canned AST + params, rendered with the chip rail so "why is this here" is self-explaining):

| Section | Definition | Cap |
|---|---|---|
| Overdue | `assignee: me · status: not DONE · overdue` | 10 |
| Going stale | `assignee: me · status: not DONE · updated: >7d` | 10 |
| Needs your reply | bespoke (comment join): I was @mentioned, haven't commented since latest mention, not DONE | 10 |
| Unowned & urgent | `unassigned · priority: High+ · status: not DONE` (workspace-wide; primary action = Assign) | 5 |

Row actions: open · assign · **Dismiss** (`d`, suppress 7d, auto-undismiss on escalation — priority raised or due arrives). Noise budget: ≤25 rows, sections render only when non-empty, badge counts *new-since-last-visit* only, **no notifications generated by triage in v1** (pull, not push). Generation: on demand at `GET /triage` (60 s per-user Redis cache), no BullMQ. v2 = opt-in daily digest (BullMQ job → Claude summarizes rule-output *metadata only*, never comment bodies).

### 2.8 Visual language
Extend, don't replace: shipped dark tokens (`#0b0d10`/`#171b1f`/`#2a2f36`/`#6b7280`), existing BEM. New class families only: `cmdbar*`, `chip*`, `view-rail*`, `triage*`. No new fonts/palette/illustrations. Motion inventory (exhaustive): chip arrival pulse (~200 ms once), ghost-chip spinner, overlay open (~120 ms). Full polish folds into roadmap 2.4.

---

## 3. System architecture

Pipeline: keystroke → deterministic parser (shared) → provisional AST → `POST /query/execute` → results. On Enter+residual → `POST /query/parse` → QueryParseService → Redis `nlq` cache (miss → Claude `claude-haiku-4-5` strict structured output = the shared Zod schema) → validate ids/enums/dates against workspace (fail-closed per clause) → AST. Execute = `compileQuery(ast)` → optional `fts.ts` id-prefilter via `$queryRaw` → `prisma.issue.findMany(where + order + cursor)` with **workspace scope injected by the compiler, always**.

### 3.1 `WorkfloQuery` AST — `packages/shared/src/query.ts`
One Zod schema, four consumers (FE chips, BE compiler, Claude structured-output contract, View storage) — the single-source-of-truth that prevents FE/BE/LLM drift, per existing `packages/shared` discipline. Flat, non-recursive (strict structured outputs forbid recursion; reinforces AND-only), every field optional, AND semantics:
```
workfloQuerySchema (v: 1):
  text?      string(≤255)                          → FTS websearch_to_tsquery
  project?   { in: projectId[] }
  type?      { in: IssueType[] }
  status?    { in: IssueStatus[] } | { not: "DONE" }
  priority?  { in: Priority[] } | { atLeast: Priority }
  assignee?  { in: userId[] } | "me" | "unassigned"
  reporter?  { in: userId[] } | "me"
  labels?    { any: labelId[] } | { all: labelId[] }
  due?       RelativeRange | { overdue: true }
  updated?   RelativeRange   // {withinDays}|{olderThanDays}|{between:[ISO,ISO]}
  created?   RelativeRange
  order?     "smart"|"updated"|"created"|"due"|"priority"
```
Symbolic time & identity (`olderThanDays:7`, `"me"`) resolved only at execution (caller + tz) — makes caches durable and views live. Versioned (`v:1`) so OR-groups are additive later. Also in shared: `queryParse{Request,Response}Schema` (`{ast, source:"cache"|"llm"|"deterministic", warnings:[{field,kind:"tentative"|"unmapped",mention,candidates?}]}`), `queryExecute{Request}`/`queryResultSchema` (SearchResult + assigneeId/dueDate/updatedAt/labelIds/type for adaptive columns), `viewSchema`, `triageResponseSchema`, `parseQueryDeterministic()` (pure, no I/O).

### 3.2 Compilation & execution — reuse, don't reinvent
New `apps/api/src/query/` (`QueryController`, `QueryCompilerService`, `QueryParseService`). `compileQuery(ast, ctx:{workspaceId,userId,now,tzOffset})` → `{where, ftsTerm?, orderBy}`. Execution mirrors `IssuesService.listByProject`: if `ftsTerm`, one `$queryRaw` via existing `issueFtsMatch/issueFtsRank` (workspace-scoped join to Project, like `SearchService.search`) → ranked ids → `{id:{in:ids}}` into `findMany` + compiled where; keyset cursor on `(orderKey,id)`.
**Compiler invariants (write as tests first — the security surface):** (1) `where` always begins with server-supplied `project:{workspaceId}` (the AST cannot name a workspace — direct application of the 2026-07-04 key-collision lesson); (2) every AST id (project/member/label) validated against the workspace before compile — invalid → drop clause + warning, never 500/silent-wrong; (3) text reaches SQL only via `Prisma.sql` params through `fts.ts`; (4) `"unassigned"` → `assigneeId: null` (also finally supplies the backend the backlog spec flagged missing). Index candidates for the migration: `@@index([assigneeId,status])`, `@@index([projectId,dueDate])`, `@@index([projectId,updatedAt])` — verify with EXPLAIN (feeds roadmap 2.5).

### 3.3 Claude parse service — fast, strict, fail-closed
`claude-haiku-4-5` (configurable via `WORKFLO_AI_QUERY_MODEL`), no thinking, `max_tokens≈1024`, client timeout **2.5 s**, `maxRetries:0` (Lane A already answered). Structured output via `messages.parse()` + `zodOutputFormat(llmParseResultSchema)` (thin wrapper over `workfloQuerySchema` + `ambiguities` + `unmapped`); closed schema (`additionalProperties:false`, enum-constrained) makes a hallucinated field/enum **unrepresentable**. Prompt (cache-ordered): ① static system (role, DSL semantics, fixed disambiguation policy, "ids must come from the directory", relative-time conventions) with `cache_control`; ② per-workspace **entity directory** (members {id,name}, projects {id,key,name}, labels {id,name}, capped 200/100/300 by recent activity, cached ~5 min); ③ volatile user turn (query + current AST when refining). Server-side re-validation of every id against the workspace (unknown → fuzzy name match → else `unmapped`); dates clamped. **Privacy boundary (fixed): the model receives the query string + the entity name directory only — data every member can already see. No issue titles/descriptions/comments in the search path.** (v2 digest sends titles, behind a workspace "AI features" setting, default-on for dogfooding — future home of an enterprise off/anonymized toggle.)

### 3.4 Latency, cost, caching (Redis)
No-LLM fast path (~70% of queries, <150 ms, 0 LLM calls); NL→AST cache `nlq:{workspaceId}:{sha256(normalized q)}` TTL 14 d (symbolic time keeps entries valid); prompt cache on system+directory blocks; budget guard `nlqbudget:{workspaceId}:{yyyymmdd}` default 2,000 parses/day → over budget = deterministic-only + quiet footer; full parse logging (latency, source, cache hit, tokens, budget) so dogfooding sets v2 knobs with data. ~$0.002/uncached Haiku parse. **The LLM is never on the critical path** (2.5 s is a UX ceiling, not a page-load ceiling). Failure matrix: Claude timeout/5xx/429/budget → Lane-A AST + footer; Redis down → skip caches, still works; `AI_QUERY_ENABLED=false` → entire surface works on the deterministic parser alone (also the shipping order).

### 3.5 New contracts / endpoints / models
Endpoints (`/api/v1`, JWT + `WorkspaceMemberGuard` `body|query:workspaceId`; Views/Triage user-scoped like Notifications):
```
POST /query/parse    {workspaceId,q,context?,tz}        → parse response
POST /query/execute  {workspaceId,ast,cursor?,limit?,tz} → {items,nextCursor}
GET/POST /views · PATCH/DELETE /views/:id
GET  /triage?workspaceId&tz                              → {sections,badge}
POST /triage/dismiss {issueId,section}
POST /triage/seen    {workspaceId}
```
`GET /search` stays (API stability); FE migrates off it. Prisma (one migration — first new models since init): `View{id,workspaceId,creatorId,name,scope PERSONAL|WORKSPACE,ast Json,pinned,timestamps,@@index([workspaceId,scope])}`, `TriageDismissal{id,userId,issueId,section,until,@@unique([userId,issueId,section])}`, `TriageSeen{userId,workspaceId,lastSeenAt,@@unique([userId,workspaceId])}` + §3.2 indexes.

---

## 4. Phased implementation plan

**V1a — engine + surface, ZERO LLM (ship first, already demo-able):**
1. Shared: `query.ts` AST + `parseQueryDeterministic` + contracts (Sonnet; schema reviewed by Opus).
2. API: compiler + `/query/execute` + migration + indexes — **needs care**, scoping invariants are security-sensitive; Opus-authored brief from §3.2; e2e includes foreign-workspace-id-in-AST attempts (expect clause-drop/empty, never leakage), mirroring the key-collision suite.
3. Web: ⌘K bar + chip rail + results + `/views/new` (generalizing `BacklogPage`) — **needs care**, the keyboard/state machine; extends `GlobalSearch`/`NotificationBell`.
4. Views CRUD + left rail + seeded defaults (Sonnet).
5. Triage rules + `/triage` + dismissals + badge (Sonnet).

**V1b — the AI layer (the flagship moment):**
6. `QueryParseService`: Haiku + `messages.parse` + entity directory + validation + Redis cache + budget + fallbacks — **needs care**, Opus-planned; golden-corpus eval before merge.
7. Bar integration: ghost chip, Enter heuristic, warning→tentative-chip rendering, request-id race guard.
8. Golden corpus: ~120 NL→expected-AST; deterministic slice in CI jest; Claude slice as recorded-fixture eval (exact-match + per-clause F1) — the quality contract for future prompt/model changes.

**V1.5 — coherence:** migrate the backlog toolbar onto the chip rail (one filter model app-wide); workspace-shared-views polish; `workspace:{id}` room for live views; query-adaptive columns on the full page; "unassigned" surfaced in backlog (now backend-supported).

**V2 — enrichment:** conversational refinement (AST-as-context mutation); triage daily digest (BullMQ + Claude summarization); AST→NL sentence rendering on view headers; OR-groups **only if** dogfooded demand; per-view subscription/digest into Phase-2.3 notification-center.

**Top risks / de-risking:**
- **NL→AST quality** (the product): golden corpus in CI + fixture evals; closed strict schema limits bad output structurally; tentative/text chips make residual errors visible + 2-keystroke-fixable, never silent → failures degrade to "search worked, one chip needed a tweak".
- **Two-lane state machine** (races/flicker): single reducer owns `{ast,pendingParse,results}`; request-id discards stale; one transition per parse; notification-bell live-arrival work already proved highlight-preservation.
- **AND-only ceiling**: text clause is the universal escape hatch; AST versioned for OR-groups; decision deferred to dogfooding query logs, not taken speculatively.
- **Triage → noise (the anti-pitch)**: hard caps, empty-by-design, dismissal+escalation-undo, pull-not-push; instrument dismiss-rate and cull any section >50% dismissed in dogfooding.

**Explicitly out of scope:** JQL / any user-visible query syntax (the whole point); Elastic/vector search (FTS until 2.5, per ADR-0006); LLM-ranked results (ranking stays deterministic/legible); triage push notifications; `>` command mode in the bar (surface is built for it; Phase 4 fills it).

---

**Handoff:** v1 decisions are final; deviations file back against this doc. Opus-author these 3 briefs before Sonnet dispatch: the compiler (§3.2 invariants), the parse service (§3.3–3.4), the command-bar state machine (§2.2–2.3). Everything else follows shipped patterns (`GlobalSearch`, `BacklogPage`, `NotificationBell`, `SearchService`, `WorkspaceMemberGuard`) closely enough for standard Sonnet briefs.
