# ADR-0005: JWT Access + Refresh Tokens with Google OAuth

## Status
Accepted — 2026-07-01

## Context
MVP needs email/password and Google OAuth login, with a single workspace role model (owner/member). Auth must work for both REST and the Socket.IO handshake, and must be safe against common web attacks.

## Decision
- **Access token:** short-lived JWT (~15 min), sent as `Authorization: Bearer`.
- **Refresh token:** long-lived, stored in an **httpOnly, Secure, SameSite** cookie; rotated on use.
- **Google OAuth:** via Passport strategy; on callback we upsert the user and issue our own tokens.
- **Socket.IO:** authenticates with the access token in the handshake.
- **AuthZ:** NestJS guards check workspace membership + role per request.

## Alternatives Considered
- **Session cookies + server-side session store** — simple and revocable, but adds stateful session storage and is clumsy for the WS handshake and future public API.
- **Access token in localStorage** — easy but XSS-exposed; rejected.
- **Managed auth (Auth0/Clerk)** — fastest, but recurring cost + lock-in for something standard; revisit if SSO/enterprise (phase 5) demands it.

## Consequences
- Positive: stateless access tokens scale across pods; refresh rotation limits blast radius of theft.
- Positive: one token model for REST + WS.
- Negative: token revocation isn't instant (mitigate with short access TTL + refresh rotation + a denylist if needed).

## Trade-offs
Statelessness and a unified REST/WS auth model are prioritised over the instant-revocation of server sessions.
