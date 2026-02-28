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

D-018: vm-based sandbox (node:vm) instead of isolated-vm — `isolated-vm` native bindings fail on Windows/Node.js v24. `node:vm` provides same interface with `runInNewContext`. Same `SandboxExecutor` interface allows swapping later. Security acceptable for v1 since only admin/deployer users write scripts. — 2026-02-28

D-019: esbuild for script compilation — TypeScript → JavaScript transpilation in <1ms. No full tsc needed. Produces clean ESM output for the sandbox. — 2026-02-28

D-020: 8-stage message pipeline — Preprocessing → source filter → source transformer → per-destination (filter → transformer → send → response transformer) → postprocessing. Matches Mirth Connect's proven pipeline model. — 2026-02-28

D-021: Channel runtime as state machine — States: UNDEPLOYED → DEPLOYING → STOPPED → STARTING → STARTED → PAUSING → PAUSED → STOPPING → HALTING. Prevents invalid transitions, enforces lifecycle ordering. — 2026-02-28

D-022: In-memory message store for v1 engine — No DB dependency for engine tests or initial development. `InMemoryMessageStore` implements `MessageStore` interface. Swap to Drizzle-backed store later. — 2026-02-28

D-023: Connection pooling for TCP/MLLP dispatcher — Pre-creates socket pool (default 5). Round-robin allocation. Idle sockets maintained with keep-alive. Avoids per-message TCP handshake overhead for high-throughput HL7 routing. — 2026-02-28

D-024: MLLP framing in dedicated module — VT (0x0B) prefix, FS+CR (0x1C+0x0D) suffix. Separate `MllpFrameParser` handles streaming reassembly of fragmented TCP data. Testable independently from connector lifecycle. — 2026-02-28

D-025: Auto-refresh via TanStack Query polling (5s interval) — No WebSocket needed for v1 dashboard/message browser. Polling is simpler, works through proxies/load balancers, and 5s is acceptable for admin monitoring. — 2026-02-28

D-026: Statistics API returns per-channel + all-channels summary — Single endpoint for dashboard summary cards (total received/sent/filtered/errored). Per-channel stats embedded in channel status for the table. Reset endpoint for testing. — 2026-02-28

D-027: Message browser with server-side pagination — Client sends page/pageSize/filters, server queries and returns total count. No client-side filtering of large datasets. Detail panel loads full message content on demand. — 2026-02-28

D-028: Native `fetch` for HTTP dispatcher — Node.js 18+ has built-in fetch. No need for axios/got dependency. Supports AbortSignal natively. — 2026-02-28

D-029: node:http for HTTP receiver (not Express sub-app) — Lightweight, no Express dependency in the connectors package. Creates a plain `http.Server`, parses request manually. Matches the TCP receiver pattern of owning the server lifecycle. — 2026-02-28

D-030: No connection pooling for HTTP dispatcher — `fetch` manages connections internally (keep-alive by default). Unlike TCP where we need explicit socket pools. — 2026-02-28

D-031: HL7 parser in `core-util` not `engine` — Parser is a general utility — used in sandbox scripts, server-side processing, and potentially CLI tools. No engine dependency needed. — 2026-02-28

D-032: 1-based indexing for HL7 paths — Matches HL7 spec. Developers expect `PID.3` to mean the 3rd field. Internal representation uses string keys for flexibility. — 2026-02-28

D-033: Soft-delete users (enabled: false) — Preserve audit trail. User IDs may be referenced in logs, messages, events. Hard delete would break referential integrity. — 2026-02-28

D-034: Admin-only user management — Matches Mirth Connect pattern. Deployers/developers/viewers cannot manage users. Self-protection: cannot disable own account or change own role. — 2026-02-28

D-035: Playwright at monorepo root, not in `packages/web/` — E2E tests span server + web + DB. Root placement matches monorepo convention. — 2026-02-28

D-036: `reuseExistingServer` for Playwright local dev — Avoids port conflicts when dev server is already running. CI starts fresh. — 2026-02-28

D-037: TCP/MLLP E2E uses ports 18661/18662 — Avoids conflict with engine E2E tests using 17661/17662. — 2026-02-28

D-038: Single Playwright worker, sequential tests — Healthcare data integrity — avoid state conflicts between parallel tests. — 2026-02-28

D-039: Optimistic locking for code templates — Same revision-based pattern used by channels. Prevents lost updates in multi-user environments. — 2026-02-28
