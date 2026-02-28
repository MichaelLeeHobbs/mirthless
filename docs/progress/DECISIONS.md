# Implementation Decisions

> Numbered log of decisions made during implementation that diverge from or clarify the design docs.

## Decisions

D-001: Workspace layout uses `packages/*` only (no `apps/*`) — Matches CLAUDE.md spec. Server and web are packages too. — 2026-02-25

D-002: Package scope is `@mirthless/*` — e.g. `@mirthless/core-models`, `@mirthless/server` — 2026-02-25

D-003: Job queue uses pg-boss — Already uses Postgres SKIP LOCKED. Proven in fullstack-template. — 2026-02-25

D-004: Auth is full JWT+sessions+RBAC from template — Skip MFA, API keys, PKI for Phase 1 (YAGNI). — 2026-02-25

D-005: PostgreSQL only — Deliberate design choice from design docs. No multi-DB support. — 2026-02-25

D-006: ESM throughout — `"type": "module"` in all package.json files — 2026-02-25

D-007: Node 22 LTS — Latest LTS as of 2026. — 2026-02-25

D-008: Single `@mirthless/connectors` package with subdirectories — Simpler than separate packages per connector. Split later only if needed (YAGNI). — 2026-02-25

D-009: User model uses `username` + `email` (not email-only like template) — Design doc 07 specifies username field for Mirth Connect compatibility. Healthcare users expect username-based login. — 2026-02-25

D-010: Four default roles: admin, deployer, developer, viewer — From design doc 05 RBAC spec. Maps to Connect's permission model but granular. — 2026-02-25

D-011: No Sentry integration in Phase 1 — YAGNI. Can add later. Removes a dependency. — 2026-02-25

D-012: No email/S3/MinIO in Phase 1 — YAGNI. Auth doesn't need email verification for internal healthcare tool. — 2026-02-25

D-013: Destinations inline with channel save — No separate CRUD endpoints. PUT /channels/:id payload gains a `destinations` array. Service syncs atomically. Matches Source tab pattern and Mirth Connect's atomic channel save. — 2026-02-28

D-014: Delete-and-reinsert for destination sync — Simplest correct approach within a transaction. No complex diffing. Acceptable because destination IDs have no external references yet (no engine, no messages). Switch to upsert when engine is running. — 2026-02-28

D-015: Monaco editor from the start — `@monaco-editor/react` is a single dependency. The entire purpose of the Scripts tab is code editing. A textarea placeholder would be replaced immediately. — 2026-02-28

D-016: Separate source vs destination connector forms — TCP/MLLP source (listener: listen address, max connections) differs from TCP/MLLP destination (client: remote host, send timeout). Same for HTTP. Sharing forms would require confusing conditionals. — 2026-02-28

D-017: Defer filters, transformers, code templates, script validation — All require the engine/sandbox to be meaningful. Pipeline editor is its own major feature. Build with engine phase. — 2026-02-28
