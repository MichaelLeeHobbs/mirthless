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

D-037: TCP/MLLP E2E uses ports 18661/18662 ��� Avoids conflict with engine E2E tests using 17661/17662. — 2026-02-28

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

D-081: AlertService.getByIds() batch query to fix N+1 — `loadAlertsForChannel()` was calling `list()` + N x `getById()`. New `getByIds(ids)` fetches all alerts, channels, and actions in 3 queries using `inArray()`. Groups results by alertId using Maps. — 2026-03-02

D-082: SOCKET_EVENT const object for centralized event names — `SOCKET_EVENT.CHANNEL_STATE`, `STATS_UPDATE`, `MESSAGE_NEW` replace 9 hardcoded string literals across deployment and message services. Type-safe, grep-friendly, single source of truth. — 2026-03-02

D-083: Typed ChannelStatus.state as ChannelState — Was `string`, now `ChannelState` (from core-models). Catches invalid state assignments at compile time. Combined with `emitStateChange()` helper that wraps `emitToAll()` with typed parameters. — 2026-03-02

D-084: useSocketRoom hook for room join/leave/reconnect — Extracted duplicated 10-11 line `useEffect` patterns from DashboardPage and MessageBrowserPage into a reusable hook. Handles join on mount, re-join on reconnect, leave on unmount. Skips join/leave if any string arg is empty (guards channel-specific rooms). — 2026-03-02

D-085: DICOM content = file path — `RawMessage.content` contains the absolute file path to the received DICOM file, not the file contents. DICOM files can be 100MB+; base64 encoding is impractical. DICOM metadata (patientName, studyInstanceUID, etc.) goes into `sourceMap`. Transformers read metadata from channel map and work with file paths. — 2026-03-02

D-086: Factory injection for DICOM testability — Both DicomReceiver and DicomDispatcher accept optional factory functions (ReceiverFactory, SenderFactory) that create the @ubercode/dcmtk objects. Tests inject mocks; production uses defaults. Mirrors the SmtpTransport/TransportFactory pattern from smtp-dispatcher.ts. No DCMTK binaries needed in CI. — 2026-03-02

D-087: DICOM dispatch mode: PER_FILE vs PER_ASSOCIATION — Source connector supports PER_FILE (default, each file = one message) and PER_ASSOCIATION (all files from one association = one message with JSON array content). PER_FILE gives transformers per-file granularity for routing by modality/patient. PER_ASSOCIATION batches files from a single sender session. — 2026-03-02

D-088: C-STORE only scope for Phase 17 — DICOM connector supports C-STORE send/receive only. C-FIND, C-MOVE, C-GET, and PacsClient are deferred to a future phase. C-STORE covers the primary medical imaging workflow (receiving images from modalities, forwarding to PACS). — 2026-03-02

D-089: Storage policy enforced in adapter, not pipeline — `createMessageStoreAdapter()` wraps `MessageService` and silently drops `storeContent()` calls for content types excluded by the channel's `messageStorageMode`. Pipeline code always calls `storeContent()`, adapter decides whether to persist. Same pattern as a no-op logger. — 2026-03-02

D-090: Content cleanup handled in adapter's markProcessed — When `removeContentOnCompletion=true`, the adapter's `markProcessed()` calls `MessageService.deleteContent()` after marking processed. Same for `removeAttachmentsOnCompletion`. Pipeline code unchanged. — 2026-03-02

D-091: Per-channel message store adapter — `createMessageStoreAdapter()` changed from shared singleton to per-channel factory that captures the channel's storage settings in a closure. Created in `EngineManager.deploy()` for each channel. Enables different channels to have different storage modes. — 2026-03-02

D-092: Storage mode content rules — DEVELOPMENT stores all content types. PRODUCTION stores only errors (11-13). RAW stores raw (1) + errors. METADATA and DISABLED store nothing. Message records and connector_message records are ALWAYS created (needed for statistics and status tracking). Only `message_content` storage is conditional. — 2026-03-02

D-093: sourceMap stored as JSON — `sourceMap` is `Record<string, unknown>` stored via `JSON.stringify()` with contentType=9 (CT_SOURCE_MAP) and dataType='JSON'. Stored before filter stage so filtered messages also have their sourceMap for debugging. Empty sourceMap `{}` still stored. — 2026-03-02

D-094: Channel groups use channels:write permission — Groups are organizational, not security-sensitive. Creating/editing groups is a channel management action. No dedicated group permissions needed. — 2026-03-02

D-095: Tags use settings:write permission — Tags are system-wide configuration. Creating/editing tags uses `settings:write`; reading tags uses `settings:read`. Consistent with other system-wide config. — 2026-03-02

D-096: Dependencies use channels:deploy permission + DAG validation — Setting dependencies affects deployment order. Service validates no circular dependencies exist using iterative DFS cycle detection. Dependencies sub-route mounted under `/channels` prefix before greedy `/:id`. — 2026-03-02

D-097: Resources store text content in DB — Resources table gets a `content text` column. Text storage sufficient for PEM certificates, XSLT files, CSV lookup tables, and JSON configs. Binary file support deferred (YAGNI). `sizeBytes` auto-computed from content. — 2026-03-02

D-098: Global Map DELETE / route before DELETE /:key — Following the settings `/bulk` before `/:key` pattern, `DELETE /` (clear all) must be mounted before `DELETE /:key` to prevent Express treating empty path as key param. — 2026-03-02

D-099: Config Map uses composite key in URL path — The `configuration` table uses `(category, name)` composite PK. API endpoints use two-segment params: `/config-map/:category/:name`. Bulk endpoint at `/config-map/bulk` mounted first. — 2026-03-02

D-100: Client-side tag filtering (not SQL join) — The statistics query is performance-critical raw SQL. Rather than adding a tag JOIN, we load tag assignments in a separate lightweight query and filter client-side. Keeps stats query fast. — 2026-03-02

D-101: System Info reuses health.service.ts functions — `SystemInfoService` calls existing `checkDatabase()`, `getMemoryStats()`, `getEngineStats()` from health.service.ts. Adds version, Node.js version, OS info, PID. — 2026-03-02

D-102: Dashboard grouped view is a toggle — Users switch between flat view (existing ChannelStatusTable) and grouped view (GroupedChannelTable with collapsible group sections). Preserves existing behavior as default. — 2026-03-02

D-103: Backup JSON format with named sections — Backup payload: `{ version: 1, exportedAt, channels, codeTemplateLibraries, codeTemplates, alerts, globalScripts, users, settings, resources, channelGroups, tags, channelDependencies, configMap, globalMap, groupMemberships, tagAssignments }`. Each section is an array. Users omit passwordHash. Channels reuse ChannelExportEntry. — 2026-03-02

D-104: Backup excludes message data — Messages, statistics, events are transient operational data. Backup captures configuration only. Avoids HIPAA complications of backing up PHI. — 2026-03-02

D-105: Restore uses per-section sequential processing — Each entity type section restored individually. If one section fails, remaining sections continue. Returns detailed per-section report. Channel restore reuses existing ChannelImportService. — 2026-03-02

D-106: Data pruner scheduling via pg-boss — pg-boss is already a dependency. `boss.schedule()` supports cron natively. No `node-cron` needed. The pruner job calls `DataPrunerService.pruneAll()`. — 2026-03-02

D-107: Pruner settings as system settings — `pruner.enabled`, `pruner.cron_expression` stored in existing `system_settings` table. Editable via Settings API. Scheduler reads on startup and when rescheduled. — 2026-03-02

D-108: Monaco sandbox types as static string constant — `.d.ts` definitions authored as a string constant in `packages/web/src/lib/sandbox-types.ts`. Hand-written to match sandbox executor API. ~80 lines. — 2026-03-02

D-109: ScriptEditor wrapper component — Shared `ScriptEditor` wraps Monaco Editor with sandbox type defs via `beforeMount`. All 5 Monaco usages switch to this wrapper. Types registered once (singleton guard). — 2026-03-02

D-110: Server logs via in-memory ring buffer — Log entries captured via Pino tee stream into fixed-size ring buffer (10,000 entries). No DB storage. For persistent logs, users use external log aggregation. — 2026-03-02

D-111: Log streaming via Socket.IO rooms — Clients join `logs` room for `server:log` events. Follows existing room pattern. Permission: `system:info`. — 2026-03-02

D-112: Native Postgres over Docker for development — Docker Desktop WSL2 incurs 100x+ WAL fsync penalty on writes (44ms vs 0.36ms per INSERT). Message processing dropped from 420ms to 13ms by switching to native Postgres. Docker remains available for CI and production. — 2026-03-29

D-113: CTE batching for pipeline DB operations — `initializeMessage()` and `finalizeMessage()` use PostgreSQL CTEs to combine 5 and 3 queries respectively into single round-trips. Reduces sequential DB calls from 10 to 2-3. Pipeline logic + VM overhead is ~1ms; all latency is DB round-trips. — 2026-03-29

D-114: Transformer scripts return `msg` not `tmp` — `compileTransformerStepsToScript()` appends `return msg;` so that `msg = 'test'` assignment pattern works. `tmp` was a Mirth Connect legacy concept for the outbound message; our simplified model uses `msg` as the primary transform target. — 2026-03-29

D-115: `correlationId` for cross-channel message tracing — UUID auto-generated on message creation, indexed. Propagated via sourceMap when Channel connector routes between channels. `requestId` stays for HTTP API tracing. `correlationId` is the cross-channel, cross-protocol tracing ID. — 2026-03-29

D-116: Send Message dialog is fire-and-forget — Dialog closes immediately on send, success/error notifications arrive async. Processing time should not block the UI. The message browser shows results when ready. — 2026-03-29

D-117: Pipeline timing as optional callback, not always-on — `onTiming` in `PipelineConfig` is `undefined` unless `LOG_LEVEL=debug`. When undefined, `mark()` calls short-circuit with zero overhead. No performance cost in production. — 2026-03-29

D-118: Idempotent SQL migrations — All migrations use `IF NOT EXISTS`, `IF EXISTS`, and `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`. Safe to re-run against existing databases. Enables switching between Docker and native Postgres without migration state conflicts. — 2026-03-29

D-119: Deploy respects channel initialState — Manual deploy auto-starts if `initialState` is STARTED, auto-starts-then-pauses if PAUSED. Matches Mirth Connect behavior. Previously deploy always returned STOPPED regardless of config. — 2026-03-29

D-120: Git as source of truth, not STATUS.md — Replaced STATUS.md with lean ROADMAP.md. Git history + CHANGELOG.md tracks what's done. DECISIONS.md tracks rationale. STATUS.md was always stale because it duplicated git. — 2026-03-29

D-121: Group CRUD inline, no dedicated page — Create group: button on dashboard. Rename/delete: kebab menu on group header. Assign channel to group: context menu + dialog. No separate Groups page needed — reduces nav clutter for a simple CRUD operation. — 2026-03-29

D-122: Script errors mark message ERROR, not silent skip — Previously pipeline silently continued when preprocessor/filter/transformer threw. Now stores error as CT_PROCESSING_ERROR (contentType 13), marks source connector ERROR, increments errored stat, notifies alert system. Destinations are not invoked. — 2026-03-29

D-123: Disabled channels cannot be deployed — Server rejects deploy for channels with `enabled: false`. Prevents accidental deployment of incomplete or intentionally disabled channels. UI shows error message. — 2026-03-29

D-124: isServiceError uses duck typing, not instanceof — stderr-lib's tryCatch reconstructs errors, breaking prototype chain. ServiceError detection checks `name === 'ServiceError'` and `typeof code === 'string'` instead of instanceof. Fixes all deployment actions returning 500 instead of proper 409/404/400. — 2026-03-29

D-125: Raw SQL for bigint column lookups in message queries — Drizzle ORM's `inArray()` silently fails with bigint columns (returns empty results). Message search connector lookup uses raw SQL `IN (${sql.join(...)})` instead. The pg driver returns bigint as string; explicit `Number()` coercion needed. — 2026-03-29

D-126: Channel group is single-select despite many-to-many join table — The `channel_group_members` table supports many-to-many, but the UI and assignment logic treat it as single-select. Group change removes ALL existing memberships before adding the new one. Simplifies UX without schema migration. — 2026-03-29

D-127: Connection test button uses centralized service, not per-connector test() methods — All 10 connector types tested via `ConnectionTestService` with tester registry. Connectors don't need a `test()` interface method. TCP/MLLP and DICOM use socket connect, HTTP uses HEAD, Database uses `SELECT 1`, SMTP uses nodemailer verify, File uses fs.access, FHIR hits /metadata. Channel and JavaScript always succeed. — 2026-03-30

D-128: Reusable TestConnectionButton component — Single component handles all connector types. Accepts connectorType, mode (SOURCE/DESTINATION), and properties props. Shows inline success/failure with latency. Used across 13 connector forms. — 2026-03-30

D-129: Sandbox escape fixed by hardening node:vm (not isolated-vm) — `isolated-vm` still does not build on Windows/Node 24 in this project, so the RCE (`logger.info.constructor('return process')()` reaching host `process`/env) is closed by re-materializing EVERYTHING inside the vm context. Data (msg/tmp/maps/sourceMap/configMap) is injected by JSON round-trip so every object has the sandbox realm's prototype chain; all bridge functions (logger, parseHL7, createACK, $, $r, $g, $gc, IO bridges, destinationSet, HL7 proxy) are re-implemented as sandbox-realm functions in a bootstrap script that calls a single host `dispatch` closure which is deleted from global scope before user code runs. No object reachable from user code has a `.constructor` chain to the host realm. IO-bridge results/errors cross as JSON strings (errors re-thrown as sandbox-realm `Error`). Tradeoff: a JSON round-trip per script execution (acceptable — correctness/security over microseconds; revisit if profiling shows it matters). Removed the dead `memoryLimit` knob (node:vm cannot enforce it) and added an async wall-clock timeout via the abort signal. — 2026-07-12

D-130: Queue claim uses a PENDING status transition, not just SKIP LOCKED — `dequeue` now atomically flips claimed rows `QUEUED → PENDING` in the same `UPDATE ... WHERE ... IN (SELECT ... FOR UPDATE SKIP LOCKED)` statement. The prior autocommit `SELECT ... FOR UPDATE SKIP LOCKED` released its lock immediately, so the 1s poll re-dequeued in-flight messages during the up-to-30s send and double-dispatched. Stale PENDING rows (crash mid-send) are reset to QUEUED on channel deploy so nothing is stranded. `send_attempts` is incremented on each requeue-after-failure (inside `updateConnectorMessageStatus` when transitioning to QUEUED) so the retry cap actually trips. — 2026-07-12

D-131: Storage policy applies to CONTENT rows only, never the message row — `initializeMessage` always writes the message + source connector + received-stat rows regardless of storage mode; only `message_content` rows are subject to `shouldStoreContent`. When no content survives the policy (PRODUCTION/METADATA/DISABLED) the content INSERT is skipped entirely rather than emitting an empty `VALUES ()` that threw and lost the whole message. Content `message_id` is bound from the `new_msg` CTE (not `currval`) so PHI content can never be misattributed to a previous message on a pooled connection. — 2026-07-12

D-132: Destination script errors fail the destination loudly — A filter or transformer script error on a destination now marks that destination ERROR (stored PROCESSING_ERROR content + errored stat + alert), matching the source stage. Previously a filter error fell through as if it passed and a transformer error sent UNTRANSFORMED data downstream. Relatedly: the source connector is no longer recorded SENT when a destination or postprocessor failed (stats would overcount throughput and hide failures), postprocessor/global-postprocessor errors now surface (error content + alert + ERROR status), and a preprocessor returning a boolean (`return true`) no longer overwrites the message with the string "true". — 2026-07-12

D-133: RecoveryManager wired into EngineManager.deploy — Recovery runs at the end of `deploy()` (so both manual deploy and `autoDeployChannels` startup benefit) after the runtime is set up: reset stale PENDING → QUEUED, reprocess RECEIVED source messages from stored raw content, re-dispatch RECEIVED destination messages from stored SENT content; QUEUED rows are left for the queue consumers. Best-effort — recovery failures are logged, never allowed to abort a deploy. Limitation: source reprocessing needs the raw content, which PRODUCTION/METADATA/DISABLED storage modes do not persist (recovery reports those as errors rather than silently losing them). — 2026-07-12

D-134: MLLP source auto-generates HL7 ACK/NAK by default — The MLLP receiver previously framed the pipeline/destination `response` back to the sender, which for an MLLP→File channel meant a filesystem path was returned as the "ACK" (and nothing on error → retransmit/duplicates). The receiver now builds a real ACK/NAK from the inbound MSH (`responseMode: AUTO_ACK` default; `PASSTHROUGH` preserves the old behavior for the rare case a destination truly returns the wire response). Chose one setting over many to keep YAGNI. — 2026-07-12

D-135: `DispatchResult.status` added (optional) to carry pipeline outcome to source connectors — Needed so the MLLP source can return AR (application reject/filter) vs AE (processing error) vs AA. Kept optional/back-compatible: absent = PROCESSED. The engine pipeline populates `status` (esp. FILTERED) so AR fires in production (wired during integration). — 2026-07-12

D-136: MLLP NAK (MSA-1 AE/AR/CE/CR) maps to ConnectorResponse status ERROR, not a rejected transport — A NAK is a valid response from a healthy connection, so the socket is released (not destroyed) but the message is marked ERROR so it surfaces and retries per queue policy. Unparseable responses are also ERROR. `classifyAckResponse` tolerates a bare MSA segment without MSH (liberal in what we accept). — 2026-07-12

D-137: First logger in connectors is pino via an injectable `ConnectorLogger` — Connectors had no logging, so silent poll-cycle catches hid vanished directories / expired DB creds / dropped IMAP. Added a pino root logger + `createConnectorLogger(name)`; each connector takes an optional injected logger (last constructor param) for testable, structured error logging. Narrow `ConnectorLogger` interface keeps mocks trivial. — 2026-07-12

D-138: TLS wired as a nested `tls` object in connector properties — Server verification (`rejectUnauthorized`) defaults TRUE on the dispatcher; never silently disabled. Presence of a `tls` prop toggles TLS. Kept option shapes minimal (cert/key/ca + optional mutual-TLS). — 2026-07-12

D-139: DoS caps default to 50 MiB (MLLP frame, HTTP body) — Comfortably exceeds any real HL7v2/FHIR payload while bounding an attacker's unauthenticated in-frame/body growth. MLLP over-limit throws+resets the parser and destroys the connection; HTTP over-limit returns 413. — 2026-07-12

D-140: File post-action failure quarantines the file (name+mtime) instead of retrying — Retrying a delete/move that already dispatched would re-dispatch the file next cycle → duplicate delivery (unacceptable for healthcare). Quarantine skips + loudly logs until an operator intervenes. In-memory only (resets on restart); durable quarantine deferred. — 2026-07-12

D-141: DB read-then-update atomicity (finding 11) deferred; visibility added instead — Full FOR UPDATE SKIP LOCKED / per-statement timeouts are a larger change touching the pool and query builder. For now the at-least-once window is made VISIBLE (SELECT + mark-as-processed UPDATE failures are logged). Follow-up tracked. — 2026-07-12
D-142: RBAC — role→permission is a single source of truth (`lib/role-permissions.ts` derived from `db/seeds/roles.ts`). API-created users now get their role's permission set assigned transactionally on create, re-synced when their role changes (`UserService.syncPermissionsForRole`). Previously only the admin seed inserted permissions, so every API-created non-admin got 403 on every guarded route (including changing their own password). Added `GET /users/:id/permissions` (view) and `POST /users/me/password` (self-service change, auth-only, no `users:write`). — 2026-07-12

D-143: encryptData is REJECTED at the API (not silently stored) until end-to-end wiring lands. The at-rest content-encryption toggle stored a flag but nothing encrypted — message content was always plaintext, so the flag masqueraded as protection. Chosen honest option: (a) ship a fully-tested AES-256-GCM primitive + key management in `lib/content-crypto.ts` (key from `CONTENT_ENCRYPTION_KEY` env, validated in config), and (b) reject any create/update that sets `encryptData: true` with `NOT_SUPPORTED` (422), and force clones to `encryptData: false`. INTEGRATION POINT: `message.service.ts` must call `content-crypto.encryptContent()` before persisting content (and `decryptContent()` on read) when `channel.encryptData` is set; once wired, replace the API rejection with the real path. (Left as honest 422 rejection for this release — see follow-up backlog.) — 2026-07-12

D-144: PHI-read auditing — HIPAA requires PHI access be auditable. Message detail, message search, and attachment content-download controllers now emit audit events (`MESSAGE_CONTENT_VIEWED`, `MESSAGE_SEARCHED`, `ATTACHMENT_DOWNLOADED`) with userId+IP via the fire-and-forget `emitEvent` (a failed audit write is logged, never blocks the read). Channel export emits `CHANNEL_EXPORTED`. New event names added to `EVENT_NAME` in core-models. — 2026-07-12

D-145: Secret redaction on read/export (`lib/secret-redaction.ts`) — Certificate private keys are never returned by GET (`CertificateDetail` exposes only `hasPrivateKey`; the key stays server-side). Secret-typed settings (new `password` setting type; `smtp.auth_pass` reclassified) are masked in GET responses. Channel exports redact secret connector properties (DB/SMTP/IMAP passwords, private keys) — re-import requires re-entering credentials. Values remain writable; only reads are masked. — 2026-07-12

D-146: Channel update is transactional with an atomic optimistic lock. The delete+reinsert of connectors/filters/transformers now runs inside `db.transaction` (a mid-way failure rolls back instead of destroying config), and the revision predicate is in the UPDATE's WHERE (`WHERE id = ? AND revision = ?`); 0 rows affected → 409 CONFLICT. Prevents interleaved concurrent updates that both passed a read-then-write check. — 2026-07-12

D-147: Default admin must change password + startup warning. Added `users.must_change_password` (migration `0006_fair_quasar.sql`); the seeded admin is created with it true. Login returns `mustChangePassword`; self password-change clears it. `lib/security-checks.warnIfDefaultAdminPassword()` logs a loud warning at startup if the admin still uses `Admin123!`. — 2026-07-12

D-148: Session lifecycle hardening — `refreshSession` re-validates the user (exists + enabled) on every refresh and drops the session for a disabled/deleted user (previously a disabled user could rotate tokens forever). Disabling or soft-deleting a user, and any password change, revokes that user's sessions. Self password-change verifies the current password and invalidates all OTHER sessions (keeps the caller's). — 2026-07-12

D-149: SSRF guard resolves DNS (`services/connection-test.service.ts`). The blocklist previously only regex-matched the hostname string, so a DNS name (or decimal/hex encoding) resolving to a private IP bypassed it. Now the host is resolved via `dns.lookup` and every resolved IP is checked against private/reserved ranges; HTTP/FHIR testers use `redirect: 'error'` to block redirect-based bypass. — 2026-07-12

D-150: Consistent error envelope + hardening — All middleware (validate/auth/permission/error/rate-limit) now return `{ success:false, error:{ code, message } }` (was `error: <string>` in places). Pino redacts `authorization`/`cookie`/`set-cookie`/secret fields. `/metrics` is auth-gated unless `METRICS_PUBLIC=true`; `/api-docs` is off in production unless `API_DOCS_ENABLED=true`; `/health*` stays public. `GET /system/logs` gained Zod query validation. Password policy adds basic complexity (≥1 letter + ≥1 digit). — 2026-07-12
D-151: UI permission gating mirrors server permission strings — Web has a local `PERMISSION` const (packages/web/src/lib/permissions.ts) duplicating the server's resource:action strings, read via `usePermissions()` from the auth store. UI gating is UX-only; the server still enforces authorization. Chose duplication over sharing through core-models to avoid coupling the web bundle to server seed code. — 2026-07-12

D-152: Global MutationCache.onError as a fail-loud safety net + toast dedupe — A single global handler surfaces an error toast for any rejected mutation so failed saves/toggles/deletes are never silent. To avoid double toasts where a call site already notifies, the notification store dedupes identical message+severity within 1.5s (and self-prunes the dedupe map). — 2026-07-12

D-153: Connector form property keys are the registry contract — Forms/defaults must write exactly the keys packages/connectors/src/registry.ts reads. Decorative controls that map to no registry key were removed rather than left misleading (TCP/MLLP charset/transmissionMode/etc.). HTTP/FHIR `headers` must be a Record<string,string> (dispatchers spread it), edited via a shared HeadersEditor. — 2026-07-12

D-154: core-models CONNECTOR_TYPES is the union of source+dest types — The shared enum now includes SMTP and EMAIL. Source vs destination validity is enforced by the UI dropdowns and the runtime registry, not the schema. Fixes SMTP destinations / EMAIL sources previously failing channel validation despite the connectors existing. — 2026-07-12

D-155: Prod Docker migrates via a standalone drizzle-orm runner, not drizzle-kit — docker/migrate.mjs uses drizzle-orm's built-in migrator (drizzle-orm + pg are prod deps) so the runtime image needs no devDependencies. Entrypoint runs migrations then an idempotent seed (SEED_ON_START, default true) before starting the server. — 2026-07-12

D-156: encryptData is now wired end-to-end (SUPERSEDES D-143) — At-rest message-content encryption is a real, working toggle. The message store adapter (engine.ts) encrypts content rows via `lib/content-crypto.ts` (AES-256-GCM, key from `CONTENT_ENCRYPTION_KEY`) before persisting and sets `message_content.is_encrypted = true`. Read paths — `MessageService.loadContent` (queue/response/recovery), `MessageQueryService.getMessageDetail` (message browser), and `MessageReprocessService` (reprocess) — call `decryptIfEncrypted()`, which decrypts only self-describing `enc:v1:` envelopes so mixed plaintext/ciphertext rows (written before/after enablement) both read back correctly. `EngineManager.deploy()` refuses to deploy an encryptData channel when no key is configured (fail loud — never store PHI as plaintext); encryption errors at write time fail the store rather than falling back to plaintext. The API 422 rejection in channel.service is removed (create/update accept the flag; clones still start with it off). Known limitation: `contentSearch` (SQL `ILIKE`) cannot match inside encrypted rows — an inherent property of at-rest encryption. — 2026-07-12

D-157: DB read-then-update is atomic via a locking transaction (SUPERSEDES D-141) — For updateMode ALWAYS/ON_SUCCESS the receiver claims rows in one transaction: `SELECT ... FOR UPDATE SKIP LOCKED`, dispatch, then ack — all while holding the row locks, so a second poller or a second engine instance cannot select the same rows and double-process them (locks release on COMMIT). `appendLockClause` adds the locking clause to the configured read query (left unchanged if it already locks); a non-lockable query (GROUP BY/DISTINCT/aggregate) fails loudly rather than silently reopening the window. Semantics: at-least-once — a row is acked only after a successful dispatch (ON_SUCCESS) / unconditionally (ALWAYS); an unacked row retries next cycle; a crash mid-transaction rolls back (no ack) so nothing is lost — the only duplication window is a crash after dispatch but before COMMIT (inherent to at-least-once). A single row's ack failure is swallowed+logged so the rest of the batch still commits (avoids rolling back already-dispatched rows). NEVER mode keeps the simple non-transactional SELECT+dispatch. Statement timeouts: `connection-pool.ts` now sets pg `statement_timeout`/`query_timeout` (30s default); IMAP ops (`email-receiver.ts`) and SMTP send (`smtp-dispatcher.ts`) are bounded by a new `withTimeout`/`withTimeoutSignal` util (connectors-local, since core-util has no DOM/node lib types). — 2026-07-12

D-158: File quarantine is durable across restarts (SUPERSEDES D-140) — The quarantine set (files dispatched-but-post-action-failed) is persisted to a sidecar JSON-array ledger `.mirthless-quarantine.json` in the watched directory. It is loaded on `onStart` (restoring the in-memory guard) and rewritten whenever a file is quarantined, so a restart does not re-dispatch an already-dispatched-but-post-action-failed file. The ledger file is excluded from polling (never dispatched). Loading is resilient: a missing ledger = empty; content not starting with `[` is treated as not-ours (no false corruption logging); a genuinely corrupt JSON array is logged loudly. A persist failure is logged loudly (the in-memory guard still holds this session). Filesystem-local — no DB dependency in the connectors package. — 2026-07-12
D-159: Web design tokens split from the MUI theme — `styles/tokens.ts` holds raw values (colours per mode, status palette, radii, font stacks); `styles/theme.ts` builds both MUI themes from them. Keeps the visual system in one auditable place and lets component overrides derive from tokens rather than hardcoded hexes. — 2026-07-12

D-160: Semantic status is a first-class part of the palette — Added `palette.status` (healthy/warning/critical/info/neutral) via MUI module augmentation, mode-tuned for AA in both light and dark. Channel states and message statuses both collapse onto these five levels via pure `lib/status.ts` so a colour means the same thing everywhere. Rendered through `StatusChip`/`StatusDot` (dot + label) so state is never colour-alone. Replaces the per-component `getStateColor`/`getStatusColor`/`getStatusDotColor` helpers. — 2026-07-12

D-161: Inter is self-hosted, not CDN-loaded — Added `@fontsource-variable/inter` (weight axis) imported in `main.tsx`; the theme already referenced Inter but nothing loaded it. Self-hosting keeps the app free of an external runtime font dependency (HIPAA/offline friendliness); woff2 subsets are split by unicode-range so only latin (~48 kB) loads for typical use. — 2026-07-12

D-162: Route-level code splitting + vendor manualChunks — Every page is `React.lazy` + Suspense (`RouteFallback` fallback), and vite `manualChunks` isolates react/mui/data/monaco vendors. Took the single 1,109 kB JS chunk down to a 413 kB largest chunk and eliminated the chunk-size warning; pages load on demand (2–21 kB each). — 2026-07-12

D-163: Shared LOADING/EMPTY/ERROR/HEADER components, applied uniformly — `PageHeader`, `EmptyState`, `ErrorState` (Alert + Retry), and `LoadingState` (`TableSkeleton`/`LoadingBlock`) replace ad-hoc per-page blocks. Skeletons preferred over spinners for lists. Fail-loud: API errors always render a visible retryable ErrorState (fixed ExtensionsPage's full-page early-return and CodeTemplatePage's plain-text loading). — 2026-07-12
D-164: Real-DB integration tests are a separate, gated Vitest lane (`.itest.ts` + `vitest.integration.config.ts`, `pnpm test:integration`), NOT part of `pnpm test` — they run only when `DATABASE_URL` targets a `*_test` database (protects dev/prod DBs from destructive inserts; skips gracefully with no DB), and use the real `db` singleton (no mocks) to catch raw-SQL/schema drift that mock-DB unit tests can't. The `.itest.ts` suffix keeps them out of the default `*.test.ts` include, and no `test/setup.ts` is loaded so the real env `DATABASE_URL` reaches the singleton. — 2026-07-12

D-165: Data-pruner delete was broken; fixed during integration — `packages/server/src/services/message-delete-helper.ts` built `message_id = ANY(${ids})`; drizzle rendered the JS array as invalid SQL and Postgres threw "malformed array literal", so `pruneChannel` always failed (surfaced fail-safe as a Failure Result; mocks hid it). Fixed by switching to drizzle `inArray(table.col, ids)`; `data-pruner.itest.ts` flipped to assert success. — 2026-07-12

D-166: Message-table partitioning declared in PartitionManagerService but NOT in the migrations — the six parent tables ship as plain `pgTable`s, not `PARTITION BY LIST (channel_id)`, so `createPartitions()` failed against the real schema (ChannelService.create swallowed it as a non-fatal warning; inserts still worked because the tables are plain). Decision (integration): the partition manager is dead code against the real schema; scheduled for Wave 2 — either add real partitioning via a recreate-tables migration or remove the manager. Until then its failure is a logged non-fatal warning, not a data risk. `partition-manager.itest.ts` cross-checks createPartitions↔partitionExists consistency in either state. — 2026-07-12
