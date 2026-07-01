# ADR-0001: Modular Monolith over Microservices

## Status
Accepted — 2026-07-01

## Context
Workflo is an early-stage product built by a small team. We need fast iteration and low operational overhead, but we also don't want to paint ourselves into a corner if usage grows.

## Decision
Build the backend as a **modular monolith** in NestJS: one deployable, internally split into strict domain modules (Auth, Users, Workspaces, Projects, Issues, Comments, Search, Notifications, Realtime) that communicate through an internal event bus.

## Alternatives Considered
- **Microservices** — best-in-class independent scaling, but massive ops cost (service discovery, network failure modes, distributed transactions) that a small team can't justify at MVP.
- **Unstructured monolith** — fastest to start, but degrades into a big ball of mud with no path to extraction.

## Consequences
- Positive: single deploy, in-process calls, simple local dev, one CI pipeline.
- Positive: strict module boundaries + event bus keep modules extractable later (a module can become a service without rewriting callers).
- Negative: everything scales together for now; a runaway module can affect others (mitigated by stateless pods + horizontal scaling).

## Trade-offs
Developer velocity and operational simplicity are prioritised over independent per-service scaling, which we don't need until phase 5.
