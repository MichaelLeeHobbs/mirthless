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

D-040: MetaDataId-based connectorId resolution for filters/transformers — UI sends destination array index + 1 as metaDataId. Server resolves to actual connector UUID after destination reinsert using `.returning()` + `destIdByMetaDataId` Map. Avoids circular dependency between destination IDs and filter/transformer insert. — 2026-03-01

D-041: Destination filter/transformer embedded in DestinationFormValues — All destination state (connector settings, queue, filter, transformer) lives in one object. Simpler than separate Maps. State stays co-located with the destination it belongs to. — 2026-03-01

D-042: Shared filter/transformer editor components — FilterRuleEditor and TransformerStepEditor used by both source and destination sections. DRY without premature abstraction — same props interface, same behavior. — 2026-03-01

D-043: Events are server-generated, not user-created — No `POST /events` endpoint. Events created internally via `emitEvent()`. Prevents users from injecting fake audit entries into the HIPAA audit log. — 2026-03-01

D-044: Fire-and-forget event emission — Non-blocking: if event write fails, original operation still succeeds. Prevents audit system from becoming a point of failure. Failures logged at WARN level. — 2026-03-01

D-045: Event purge via `DELETE /events?olderThanDays=N` — Admin-only (`settings:write` permission). Simple query param, no request body on DELETE. — 2026-03-01

D-046: Settings use upsert by key (not separate create/update) — Drizzle `onConflictDoUpdate` on unique `key` constraint. Simpler for the Settings page which just submits current form state. — 2026-03-01

D-047: AuditContext passed as explicit parameter to services — `{ userId, ipAddress }` passed from controllers, not via AsyncLocalStorage. Testable, explicit, follows KISS. — 2026-03-01

D-048: File connector uses `node:fs/promises` only — No SFTP/S3/SMB support in v1. Local filesystem only. YAGNI — add remote protocols when there's a real use case. — 2026-03-01

D-049: Simple glob matching for file connector — Use basic wildcard pattern matching (*, ?) rather than a full glob library dependency. Sufficient for file connectors. — 2026-03-01

D-050: PostgreSQL only for database connector — Consistent with D-005. No multi-DB driver abstraction. Uses `pg` directly. Other databases can be added as separate connector types later. — 2026-03-01

D-051: QueryBuilder parameterized binding — Database connector replaces `${variable}` with positional `$1, $2, ...` params. Values never interpolated into SQL strings. Security-first design for healthcare data. — 2026-03-01

D-052: Partition-per-channel for message tables — `CREATE TABLE IF NOT EXISTS messages_p_{id} PARTITION OF messages FOR VALUES IN ('{id}')`. Created on channel create, dropped on channel delete. Enables efficient per-channel queries and independent cleanup. — 2026-03-01

D-053: Data pruner as admin API (not cron) — `POST /api/v1/admin/prune` endpoint for v1. Cron/scheduled pruning is future work. Keeps implementation simple. — 2026-03-01

D-054: Queue manager uses FOR UPDATE SKIP LOCKED — Enables concurrent queue consumers without lock contention. Messages claimed atomically, failed messages released back for retry. — 2026-03-01

D-055: JavaScript connector uses callback injection (ScriptRunner/DestScriptRunner) — Connector receives a callback at runtime, not a direct vm dependency. Testable with simple mock functions. Engine wires the actual sandbox executor at deploy time. — 2026-03-01

D-056: SMTP connector uses SmtpTransport abstraction — Constructor accepts optional `TransportFactory` for dependency injection. Tests pass mock transport. Production uses `createNodemailerTransport()`. Avoids mocking nodemailer internals. — 2026-03-01

D-057: Channel connector uses static in-memory registry — `Map<string, ChannelDispatchCallback>` for zero-network-overhead inter-channel routing. Source registers on start, destination looks up target on send. No serialization, no protocol overhead. — 2026-03-01

D-058: FHIR connector destination-only for v1 — FHIR subscription source (R4 SubscriptionTopic) deferred. Requires WebSocket/webhook handling complexity. Destination covers the primary use case (sending resources to FHIR servers). — 2026-03-01

D-059: Channel import collision modes: SKIP, OVERWRITE, CREATE_NEW — SKIP ignores duplicates, OVERWRITE replaces existing (delete-and-reinsert relations), CREATE_NEW assigns new UUID. Covers dev→staging→prod promotion, backup restore, and merge workflows. — 2026-03-01

D-060: Alert evaluation with throttle and max-alerts — `reAlertIntervalMs` prevents re-triggering within cooldown window. `maxAlerts` caps total alerts per trigger. Prevents alert storms from noisy channels while ensuring critical errors are surfaced. — 2026-03-01

D-061: DICOM connector deferred to dedicated phase — Requires dcmtk.js native bindings and DIMSE protocol (C-STORE, C-FIND, C-MOVE). Too complex to batch with other connectors. Will be its own focused implementation phase. — 2026-03-01

D-062: AlertManager created per channel deployment, not globally — Each channel gets its own AlertManager with channel-scoped alerts loaded at deploy time. Simpler lifecycle: clear throttle state on undeploy, reload alerts on redeploy. No cross-channel alert state leaks. — 2026-03-01

D-063: JavaScript connector wiring via closure-based ScriptRunner — Engine creates a closure that captures the sandbox executor, compiles user scripts with esbuild, and executes them in the vm sandbox. Avoids direct vm dependency in the connectors package. Testable with simple mock functions. — 2026-03-01

D-064: EmailSender as dependency injection callback — Same pattern as ChannelSender. Server layer provides the actual nodemailer transport at startup. Engine package stays transport-agnostic. Testable by injecting a mock function. — 2026-03-01

D-065: CLI uses `~/.mirthless/config.json` for persistent config — Token stored after `login` command. Follows convention of tools like Docker, AWS CLI, GitHub CLI. Simple JSON format. — 2026-03-01

D-066: Channel clone starts disabled — Safety measure. Prevents accidental duplicate message routing when cloning an active channel. User must explicitly enable the clone after reviewing its configuration. — 2026-03-01

D-067: CLI communicates via HTTP API (same as web UI) — No special admin socket, IPC, or direct DB access. Any endpoint available to the web UI is available to the CLI with the same auth and RBAC. Simplest correct approach. — 2026-03-01

D-068: Email service reads SMTP config from settings table per-send — No cached transport. Creates and closes nodemailer transport on each send. Simpler lifecycle, automatically picks up settings changes. Acceptable for alert volume (not bulk email). — 2026-03-01

D-069: Connector property validation at deploy time — Zod schemas validate required fields before engine.deploy(). Prevents runtime failures from missing port, empty directory, etc. Unknown connector types pass validation (forward compatibility). — 2026-03-01

D-070: Three health endpoints (live/ready/full) — `/health/live` always 200 (k8s liveness). `/health/ready` checks DB (k8s readiness). `/health` returns full status with engine stats and memory usage. Industry standard Kubernetes health probe pattern. — 2026-03-01

D-071: Health check logic extracted to health.service.ts — Testable without supertest. Service functions unit-tested with mocked DB and engine. Express endpoints are thin wrappers. — 2026-03-01

D-072: Script validation returns syntax errors as successful result — `{ ok: true, value: { valid: false, errors } }` — the service call succeeded, the script is invalid. Only infrastructure failures (esbuild crash) would return `ok: false`. Follows Result<T> pattern correctly. — 2026-03-01

D-073: Script validation uses esbuild transform (not full compile) — Same approach as engine's script-compiler. In-process, <1ms, no filesystem. Catches syntax errors without executing code. — 2026-03-01

D-074: Rate limiting on /refresh endpoint — Same `authRateLimiter` as /login. Refresh tokens can be abused for session hijacking attempts. Consistent security posture across all auth endpoints. — 2026-03-01

D-075: QueueConsumer per queued destination, lifecycle tied to channel start/stop — Each queued destination gets its own QueueConsumer instance created during `deploy()`. Consumers start with `start()` and stop with `stop()`/`halt()`/`undeploy()`. Config uses per-destination retryCount and retryIntervalMs. Keeps queue processing co-located with channel lifecycle. — 2026-03-01

D-076: Socket.IO JWT auth via handshake `auth.token` parameter — Client passes JWT in the `auth` object during Socket.IO handshake (not cookies, not query params). Middleware validates token before connection is established. Same JWT validation as REST API. Prevents unauthenticated WebSocket connections. — 2026-03-01

D-077: Channel-based rooms for scoped message push — Socket.IO rooms (`channel:{id}`, `dashboard`) scope event emission. Dashboard room receives channel state changes and statistics updates. Channel rooms receive new message notifications. Avoids broadcasting everything to all clients. — 2026-03-01

D-078: Keep polling as fallback alongside WebSocket (graceful degradation) — Dashboard and Message Browser retain `refetchInterval` polling even with WebSocket enabled. If WebSocket disconnects, polling provides continued updates. Eliminates single point of failure for real-time updates. — 2026-03-01

D-079: Socket reconnect re-joins rooms and invalidates all queries — On WebSocket reconnection, client re-joins previously subscribed rooms and invalidates all TanStack Query caches. Ensures no stale data after a connectivity gap. Token refresh triggers socket reconnection with updated auth. — 2026-03-01

D-080: JS connector scripts compiled once at deploy, not per-message — `compileScript()` called during `deploy()` and result captured in closure. `setScriptRunner` callback reuses pre-compiled script. Eliminates redundant esbuild transpilation on every message. Compile failures surface at deploy time, not at first message. — 2026-03-02

D-081: AlertService.getByIds() batch query to fix N+1 — `loadAlertsForChannel()` was calling `list()` + N × `getById()`. New `getByIds(ids)` fetches all alerts, channels, and actions in 3 queries using `inArray()`. Groups results by alertId using Maps. — 2026-03-02

D-082: SOCKET_EVENT const object for centralized event names — `SOCKET_EVENT.CHANNEL_STATE`, `STATS_UPDATE`, `MESSAGE_NEW` replace 9 hardcoded string literals across deployment and message services. Type-safe, grep-friendly, single source of truth. — 2026-03-02

D-083: Typed ChannelStatus.state as ChannelState — Was `string`, now `ChannelState` (from core-models). Catches invalid state assignments at compile time. Combined with `emitStateChange()` helper that wraps `emitToAll()` with typed parameters. — 2026-03-02

D-084: useSocketRoom hook for room join/leave/reconnect — Extracted duplicated 10-11 line `useEffect` patterns from DashboardPage and MessageBrowserPage into a reusable hook. Handles join on mount, re-join on reconnect, leave on unmount. Skips join/leave if any string arg is empty (guards channel-specific rooms). — 2026-03-02

D-085: DICOM content = file path — `RawMessage.content` contains the absolute file path to the received DICOM file, not the file contents. DICOM files can be 100MB+; base64 encoding is impractical. DICOM metadata (patientName, studyInstanceUID, etc.) goes into `sourceMap`. Transformers read metadata from channel map and work with file paths. — 2026-03-02

D-086: Factory injection for DICOM testability — Both DicomReceiver and DicomDispatcher accept optional factory functions (ReceiverFactory, SenderFactory) that create the @ubercode/dcmtk objects. Tests inject mocks; production uses defaults. Mirrors the SmtpTransport/TransportFactory pattern from smtp-dispatcher.ts. No DCMTK binaries needed in CI. — 2026-03-02

D-087: DICOM dispatch mode: PER_FILE vs PER_ASSOCIATION — Source connector supports PER_FILE (default, each file = one message) and PER_ASSOCIATION (all files from one association = one message with JSON array content). PER_FILE gives transformers per-file granularity for routing by modality/patient. PER_ASSOCIATION batches files from a single sender session. — 2026-03-02

D-088: C-STORE only scope for Phase 17 — DICOM connector supports C-STORE send/receive only. C-FIND, C-MOVE, C-GET, and PacsClient are deferred to a future phase. C-STORE covers the primary medical imaging workflow (receiving images from modalities, forwarding to PACS). — 2026-03-02
