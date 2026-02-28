# Implementation Changelog

> Session-by-session log of what was built. Enables any future Claude instance to pick up where we left off.

## 2026-02-25 — Initial Scaffolding

### What was done:
- Created progress tracking system (`docs/progress/`)
- Set up monorepo root configuration (package.json, tsconfig, eslint, prettier, etc.)
- Docker setup with PostgreSQL 17
- Scaffolded all 7 packages:
  - `@mirthless/core-models` — branded types, constants, Zod schemas from design doc 01
  - `@mirthless/core-util` — Result re-export, validation utils
  - `@mirthless/engine` — empty shell
  - `@mirthless/connectors` — empty shell with base interface
  - `@mirthless/server` — Express app, config, middleware, Drizzle schema, auth, seeds
  - `@mirthless/web` — React+MUI shell, auth flow, login page
  - `@mirthless/cli` — empty shell
- Adapted auth system from fullstack-template (JWT + sessions + RBAC)
- Wrote Drizzle schema for all tables from design doc 07
- Verified: pnpm install (833 packages), build (0 errors), lint (0 warnings), test (framework runs)

### Build fixes applied:
- Zod v4: `z.record(z.unknown())` → `z.record(z.string(), z.unknown())` (2-arg requirement)
- stderr-lib Result<T>: Success needs `error: null`, Failure needs `value: null`
- Web tsconfig: `module: "ESNext"`, `moduleResolution: "bundler"` (for MUI + Vite)
- `exactOptionalPropertyTypes`: conditional property inclusion instead of `undefined` assignment
- Vitest: `passWithNoTests: true` in all 6 configs
- Drizzle bigint: `mode: 'number'` instead of `mode: 'bigint'` (BigInt JSON.stringify error in Drizzle Kit)
- Replaced `bcrypt` with `bcryptjs` (native binding missing for Node.js v24 on Windows)
- Web API base URL: `/api/v1` (matches server route mount)

### Key decisions made:
- See DECISIONS.md D-001 through D-012

### What's next:
- Channel CRUD API endpoints
- Channel list page in web UI
- Engine message pipeline (Phase 2)

## 2026-02-26 — Channel CRUD API + Channel List UI

### What was done:
- **Channel CRUD API** (6 endpoints):
  - `GET /channels` — paginated list
  - `POST /channels` — create with default scripts
  - `GET /channels/:id` — full detail with scripts/destinations/tags
  - `PUT /channels/:id` — update with optimistic locking (revision)
  - `DELETE /channels/:id` — soft-delete
  - `PATCH /channels/:id/enabled` — toggle enabled flag
- **Server files created:**
  - `channel.service.ts` — business logic (list, getById, create, update, delete, setEnabled)
  - `channel.controller.ts` — HTTP adapter (error code → HTTP status mapping)
  - `channel.routes.ts` — route definitions with auth/permission/validation middleware
  - `channel.service.test.ts` — 18 unit tests covering all methods and error paths
- **Server files modified:**
  - Added `CONFLICT` error code to `service-error.ts`
  - Added `updateChannelSchema`, `channelListQuerySchema`, `patchChannelEnabledSchema` to `channel.schema.ts`
  - Registered `/channels` routes in `routes/index.ts`
- **Channel List UI** (web package):
  - `use-channels.ts` — TanStack Query hooks (useChannels, useChannel, useCreateChannel, useUpdateChannel, useDeleteChannel, useToggleChannelEnabled)
  - `ChannelsPage.tsx` — MUI Table with pagination, search, enable/disable toggle, delete confirmation
  - `NewChannelDialog.tsx` — modal form for creating channels (React Hook Form)
  - Added `api.patch()` convenience method to API client
  - Registered `/channels` route in App.tsx

### Build notes:
- Express 5 `req.params` returns `string | string[]` — cast to `string` after validation middleware
- `CreateChannelInput` (Zod inferred type) requires `enabled` and `responseMode` even though they have Zod defaults — must be explicit in client-side calls

### What's next:
- Channel editor page (Summary + Source tabs)
- Channel deployment/lifecycle API
- Dashboard with channel statistics

## 2026-02-28 — Channel Editor: Summary + Source Tabs

### What was done:
- **Channel Editor page** with tabbed interface (5 tabs, 2 implemented):
  - `ChannelEditorPage.tsx` — react-hook-form, useBlocker for unsaved changes, create + edit modes
  - `SummaryTab.tsx` — name, description, enabled, data types, initial state
  - `SourceTab.tsx` — connector settings dispatch + response settings
- **Source connector forms** (dynamic dispatch pattern):
  - `ConnectorSettingsSection.tsx` — component map by connector type
  - `TcpMllpSourceForm.tsx` — listener settings (host, port, max connections, charset, etc.)
  - `HttpSourceForm.tsx` — listener settings (host, port, context path, methods, response content type)
  - `UnsupportedConnectorPlaceholder.tsx` — fallback for unimplemented types
  - `connector-defaults.ts` — default property objects per type
  - `ResponseSettingsSection.tsx` — response mode, response connector name
- **Bug fixes across 3 sessions:**
  - Auth error responses: `{ code, message }` object format
  - Switched to `createBrowserRouter` (data router) for `useBlocker` support
  - API client: handle 204 No Content responses
  - Layout: flex overflow with `minWidth: 0`, vertical scroll fixes
  - React effect ordering: `isResettingRef` guard for form population
- **Manual test suite:** 8 test files, 81 scenarios, all passing
- **Schema + controller tests:** 29 schema + 13 controller tests added

### Build notes:
- `useBlocker` requires data router (`createBrowserRouter` + `RouterProvider`), not `BrowserRouter`
- API 204: check `response.status === 204` before `response.json()`
- MUI Grid: use `<Grid item xs={12} md={6}>`, not `size` prop
- Flex overflow: add `minWidth: 0` to flex children for `textOverflow: ellipsis`

### What's next:
- Destinations tab, Scripts tab (Monaco), Advanced tab

## 2026-02-28 — Complete Channel Editor: Destinations, Scripts, Advanced

### What was done:
- **Destinations tab** — two-panel layout:
  - `DestinationsTab.tsx` — main container with list + settings panels
  - `DestinationListPanel.tsx` — sidebar with add/remove/move-up/move-down controls
  - `DestinationSettingsPanel.tsx` — name, enabled, connector type, connector form, queue settings
  - `DestinationConnectorSettings.tsx` — dynamic form dispatch (same pattern as source)
  - `TcpMllpDestinationForm.tsx` — client settings (remote host, port, send timeout, keep-alive)
  - `HttpDestinationForm.tsx` — client settings (URL, method, headers, content type, response timeout)
  - `QueueSettingsSection.tsx` — queue mode, retry count/interval, rotate, thread count, wait-for-previous
  - `connector-defaults.ts` — default properties for destination connectors
  - `types.ts` — DestinationFormValues, DestConnectorFormProps interfaces
- **Scripts tab:**
  - `ScriptsTab.tsx` — 4 MUI Accordions with Monaco `<Editor>` instances (deploy, undeploy, preprocessor, postprocessor)
  - Installed `@monaco-editor/react` dependency
- **Advanced tab:**
  - `AdvancedTab.tsx` — message storage (radio group), encrypt/remove switches, pruning settings, custom metadata columns table
- **Schema changes** (`core-models`):
  - Added `destinationInputSchema` (name, connectorType, properties, queue settings)
  - Added `metadataColumnInputSchema` (name, dataType, mappingExpression)
  - Added pruning fields to `channelPropertiesSchema` (pruningEnabled, pruningMaxAgeDays, pruningArchiveEnabled)
  - Extracted `connectorTypeSchema` for reuse
  - Added `destinations` and `metadataColumns` arrays to `createChannelSchema`
  - **22 new schema tests** (51 total)
- **Service changes** (`server`):
  - Expanded `ChannelDestination` interface with full fields (properties, queue settings)
  - Expanded `ChannelDetail` with removeContent/removeAttachments/pruning fields
  - `fetchChannelRelations` now selects all connector columns, ordered by metaDataId
  - Destination sync in `create()` and `update()`: delete-and-reinsert with auto metaDataId
  - Metadata column sync: same delete-and-reinsert pattern
  - Pruning fields wired through create/update
  - **5 new service tests** (23 total)
- **ChannelEditorPage wiring:**
  - Expanded form state: destinations (useState), scripts (useState), advanced (useState)
  - Manual dirty tracking (`extraDirty`) for non-react-hook-form state
  - `onSubmit` builds full payload including destinations, scripts, metadataColumns, expanded properties
  - Replaced 3 `PlaceholderTab` instances with real components
- **Expanded `ChannelDetail` type** in `use-channels.ts` (full destination fields, pruning)
- **5 new manual test files:** destinations tab, dest TCP/MLLP, dest HTTP, scripts tab, advanced tab
- Updated data roundtrip tests to cover all new features

### Key decisions:
- D-013: Destinations inline with channel save (no separate CRUD endpoints)
- D-014: Delete-and-reinsert for destination sync (simplest within transaction, no external refs yet)
- D-015: Monaco from the start (core purpose of Scripts tab is code editing)
- D-016: Separate source vs destination connector forms (TCP/MLLP listener ≠ client)
- D-017: Defer filters, transformers, code templates, script validation to engine phase

### What's next:
- Engine pipeline (filters, transformers, sandbox)
- Dashboard with channel statistics
- Channel deployment/lifecycle API

## 2026-02-28 — Engine Foundation: Sandbox, Pipeline, Connectors, Deployment

### What was done:
- **Sandbox** (`engine`):
  - `VmSandboxExecutor` — vm-based script execution with `runInNewContext`, timeout enforcement
  - `ScriptCompiler` — esbuild TypeScript → JavaScript transpilation
  - `SandboxContext` — channel/connector maps, logger, message helpers exposed to user scripts
- **8-stage message pipeline** (`engine`):
  - `MessageProcessor` — preprocessing → source filter → source transformer → per-destination (filter → transformer → send → response transformer) → postprocessing
  - Each stage produces `MessageStatus` (TRANSFORMED, FILTERED, SENT, ERROR, QUEUED)
- **Channel runtime** (`engine`):
  - `ChannelRuntime` — state machine (UNDEPLOYED → DEPLOYING → STOPPED → STARTING → STARTED → PAUSING → PAUSED → STOPPING → HALTING)
  - `QueueConsumer` — pulls messages from queue, dispatches through pipeline
  - `InMemoryMessageStore` — implements `MessageStore` interface for tests
- **TCP/MLLP connectors** (`connectors`):
  - `TcpMllpReceiver` — TCP server with MLLP framing, connection tracking, graceful shutdown
  - `TcpMllpDispatcher` — TCP client pool with round-robin allocation, MLLP framing, response timeout
  - `MllpFrameParser` — streaming MLLP frame reassembly (VT prefix, FS+CR suffix)
  - `SourceConnectorRuntime` / `DestinationConnectorRuntime` interfaces in `base.ts`
  - Connector registry with factory pattern
- **Deployment API** (`server`, 8 endpoints):
  - `POST /deploy/:id` — deploy channel (compile scripts, create connectors, wire pipeline)
  - `POST /undeploy/:id` — undeploy channel
  - `POST /start/:id`, `/stop/:id`, `/halt/:id`, `/pause/:id`, `/resume/:id` — lifecycle control
  - `GET /status/:id` — channel runtime status with statistics
  - `DeploymentService`, `DeploymentController`, deployment routes
  - Engine manager singleton bridges server → engine
- **Message Query API** (`server`, 4 endpoints):
  - `GET /channels/:id/messages` — search/filter with server-side pagination
  - `GET /channels/:id/messages/:messageId` — full message detail with content
  - `DELETE /channels/:id/messages/:messageId` — delete message
  - `DELETE /channels/:id/messages` — bulk delete with filters
  - `MessageQueryService`, `MessageController`, message routes
- **Statistics API** (`server`, 3 endpoints):
  - `GET /statistics` — all-channels summary
  - `GET /statistics/:id` — per-channel statistics
  - `POST /statistics/:id/reset` — reset channel statistics
  - `StatisticsService`, `StatisticsController`, statistics routes
- **E2E test:** ADT^A01 message flows TCP (port 17661) → pipeline → TCP (port 17662) with in-memory store
- **Tests:** 68 engine + 26 connector + 13 deployment + 19 message-query + 9 statistics = **135 new tests**

### Key decisions:
- D-018: vm-based sandbox (node:vm) — isolated-vm fails on Windows/Node.js v24
- D-019: esbuild for script compilation — <1ms TypeScript transpilation
- D-020: 8-stage pipeline — matches Mirth Connect's proven model
- D-021: Channel runtime as state machine — prevents invalid transitions
- D-022: In-memory message store for v1 — no DB dependency for engine tests
- D-023: Connection pooling for TCP/MLLP dispatcher — round-robin socket pool
- D-024: MLLP framing in dedicated module — testable independently

### Build notes:
- `isolated-vm` native bindings fail on Windows/Node.js v24 — use node:vm fallback
- `db.execute()` returns `QueryResult<T>` with `.rows`, not raw array
- TCP connect to non-listening port hangs on Windows — use abort signals instead
- MLLP framing: VT=0x0B prefix, FS+CR=0x1C+0x0D suffix

### What's next:
- Dashboard with channel statistics
- Message browser UI
- HTTP connector, HL7 parser

## 2026-02-28 — Dashboard, Message Browser, and Supporting API

### What was done:
- **Dashboard page** (`web`):
  - `DashboardPage.tsx` — summary cards (total channels, received, sent, errored) + channel status table
  - `SummaryCards.tsx` — 4 stat cards with MUI Paper
  - `ChannelStatusTable.tsx` — channel name, state chip, received/sent/filtered/errored counts, quick actions
  - Quick actions: deploy/undeploy, start/stop/pause/resume per channel
  - Auto-refresh via TanStack Query polling (5s `refetchInterval`)
- **Message Browser page** (`web`):
  - `MessageBrowserPage.tsx` — search bar + paginated table + detail panel
  - `MessageSearchBar.tsx` — status filter, date range, text search
  - `MessageTable.tsx` — message ID, status chip, received date, connector name, content preview
  - `MessageDetailPanel.tsx` — full message content with Raw/Encoded/Transformed tabs, copy-to-clipboard
  - Server-side pagination, filter by status/date/text
- **Supporting hooks** (`web`):
  - `use-deployment.ts` — TanStack Query mutations for deploy/undeploy/start/stop/pause/resume
  - `use-statistics.ts` — useAllStatistics, useChannelStatistics queries
  - `use-messages.ts` — useMessages (paginated), useMessageDetail, useDeleteMessage queries
- **API client additions** (`web`):
  - Deployment methods: deploy, undeploy, start, stop, halt, pause, resume, getStatus
  - Statistics methods: getAllStatistics, getChannelStatistics, resetStatistics
  - Message methods: getMessages, getMessageDetail, deleteMessage, bulkDeleteMessages
- **App routing:** Added `/channels/:id/messages` route for message browser
- **Layout:** Added navigation links for Dashboard and Messages in AppLayout sidebar

### Key decisions:
- D-025: Auto-refresh via TanStack Query polling (5s) — no WebSocket for v1
- D-026: Statistics API returns per-channel + all-channels summary
- D-027: Message browser with server-side pagination

### What's next:
- HTTP connector (second protocol)
- HL7v2 parser for user scripts
- User management UI

## 2026-02-28 — HTTP Connector, HL7v2 Parser, User Management

### What was done:

**Phase 1 — HTTP Connector** (`connectors`):
- `HttpReceiver` — HTTP source connector using `node:http`. Implements `SourceConnectorRuntime`. Validates method/path, reads body, builds `sourceMap` with HTTP metadata (remoteAddress, method, path, headers, queryString, contentType).
- `HttpDispatcher` — HTTP destination connector using native `fetch`. Uses `AbortSignal.any()` for combined timeout+abort. Returns `ConnectorResponse` with SENT/ERROR status.
- Registry updated with HTTP factories for both source and destination
- Re-exported from `connectors/index.ts`
- **23 tests** (12 receiver + 11 dispatcher)

**Phase 2 — HL7v2 Parser** (`core-util`):
- `hl7-encoding.ts` — Delimiter detection from MSH segment, escape/unescape with all standard sequences (`\F\`, `\S\`, `\T\`, `\R\`, `\E\`, `\Xnn\` hex)
- `hl7-path.ts` — Path parsing (`PID.3.1` → structured `Hl7Path`), auto-resolve of missing indices
- `hl7-message.ts` — Core parser class: `parse()`, `get()`, `set()`, `delete()`, `toString()`, `getSegmentString()`, `getSegmentCount()`. Nested numeric-indexed internal representation. MSH special handling. Round-trip preserving.
- `hl7-ack.ts` — ACK/NAK message generation (AA/AE/AR), sender/receiver swap, MSA + optional ERR segment
- `hl7/index.ts` — Public re-exports
- Re-exported from `core-util/index.ts`
- **68 tests** (19 encoding + 10 path + 32 message + 7 ACK)

**Phase 3 — User Management** (`server` + `web`):
- **API** (7 endpoints):
  - `GET /users` — list all users (admin only)
  - `POST /users` — create user (admin only)
  - `GET /users/:id` — get user detail
  - `PUT /users/:id` — update user (admin only)
  - `DELETE /users/:id` — soft-delete via enabled=false (admin only)
  - `POST /users/:id/password` — change password (admin or self)
  - `POST /users/:id/unlock` — unlock locked account (admin only)
- `UserService` — 7 static methods with self-protection (cannot disable own account, cannot change own role, cannot delete last admin), bcryptjs password hashing
- `UserController` — HTTP adapter with error code → status mapping
- Schema additions: `changePasswordSchema`, `userIdParamSchema`
- **20 server tests** (user service)
- **Users page** (`web`):
  - `UsersPage.tsx` — Table with username, email, full name, role chip, enabled status, last login, actions (edit/disable/unlock)
  - `UserDialog.tsx` — Create/edit dialog with username, email, password, first/last name, role select
  - `use-users.ts` — TanStack Query hooks (useUsers, useUser, useCreateUser, useUpdateUser, useDeleteUser, useChangePassword, useUnlockUser)
  - API client: added `UserSummary`, `UserDetail` interfaces and 7 API methods
  - App.tsx: added `/users` route

### Key decisions:
- D-028: Native `fetch` for HTTP dispatcher — Node.js 18+ built-in, no extra dependency
- D-029: node:http for HTTP receiver — lightweight, no Express dependency in connectors package
- D-030: No connection pooling for HTTP dispatcher — fetch manages connections internally
- D-031: HL7 parser in `core-util` not `engine` — general utility, used in sandbox scripts + server
- D-032: 1-based indexing for HL7 paths — matches HL7 spec
- D-033: Soft-delete users (enabled: false) — preserve audit trail, referential integrity
- D-034: Admin-only user management — matches Mirth Connect pattern, self-protection rules

### Build notes:
- Registry Map type inference: `exactOptionalPropertyTypes` required explicit `new Map<string, Factory>()` and return type annotations on lambdas
- `let` → `const` in hl7-path.ts (field never reassigned)
- Removed unused eslint-disable directives in hl7-message.ts

### Verification:
- `pnpm build` — 0 errors
- `pnpm lint` — 0 warnings
- `pnpm test` — **369 tests passing** (258 existing + 111 new)

### What's next:
- Code templates (reusable JavaScript functions shared across channels)
- Alert system (configurable notifications on channel events/errors)
- File connector, Database connector
- Persistent message store (Drizzle-backed, replacing in-memory)
