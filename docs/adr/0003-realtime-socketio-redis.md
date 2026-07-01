# ADR-0003: Socket.IO + Redis Adapter for Real-time

## Status
Accepted — 2026-07-01

## Context
Real-time collaboration (live board moves, comment updates, presence) is a core differentiator vs Jira and must exist from MVP. The API runs as multiple stateless pods, so real-time must fan out across pods.

## Decision
Use **Socket.IO** (NestJS WebSocket gateway) with the **Redis adapter** for cross-pod fan-out. Authenticate the socket handshake with the same JWT used for REST. Clients join `project:{id}` and `issue:{key}` rooms.

## Alternatives Considered
- **Raw WebSockets (ws)** — lighter, but we'd reimplement rooms, reconnection, acks, and fan-out that Socket.IO gives for free.
- **Server-Sent Events (SSE)** — one-way only; we need bidirectional (presence, typing).
- **Managed (Pusher/Ably)** — fastest to integrate, but recurring cost + vendor lock-in for something Redis handles cheaply.

## Consequences
- Positive: rooms, reconnection, and multi-pod fan-out out of the box; Redis is already in the stack.
- Positive: same JWT → unified auth model.
- Negative: Socket.IO has a heavier client/protocol than raw WS; sticky sessions or the Redis adapter required (we use the adapter).

## Trade-offs
Feature completeness and speed-to-build are prioritised over the minimal footprint of raw WebSockets.
