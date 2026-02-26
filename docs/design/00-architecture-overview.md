# 00 — Architecture Overview

> Mirthless: a spiritual remake of NextGen Connect (Mirth Connect) for Node.js/TypeScript.

## Connect at a Glance

NextGen Connect is a ~1,900 Java file monolith organized into 16 modules. The core abstractions are sound — the implementation is not. This document maps what Connect does, what's broken, and how we redesign it.

### Module Map

| Connect Module | Files | What It Does | Our Equivalent |
|---|---|---|---|
| `core-models` | 233 | Domain types: Channel, Connector, Message, Filter, Transformer, CodeTemplate, Alert, User | `packages/core-models` |
| `donkey` | 103 | Message processing engine: pipeline, channel lifecycle, queuing, recovery | `packages/engine` |
| `server` | 554 | REST API (15 servlets), auth, deployment orchestration, DB access, plugin system | `packages/server` |
| `core-server-plugins` | 190 | Connector implementations + data type plugins + transformer step plugins | `packages/connectors/*` |
| `core-util` | 123 | Serialization, JS execution (Rhino), encryption, format conversion, MLLP framing | `packages/core-util` |
| `client` | 337 | Swing admin GUI | `packages/web` (React) |
| `core-ui` | 148 | Shared Swing UI components | `packages/web` (React) |
| `core-client-*` | 142 | Client-side connector panels, API client | `packages/web` (React) |
| `command` | 10 | CLI tool | `packages/cli` |
| `webadmin` | 10 | JSP web admin (minimal) | `packages/web` (React) |

---

## Core Concepts Worth Keeping

These abstractions are the right model for a healthcare integration engine:

### 1. Channel = Message Processing Pipeline
A channel has one **source connector** (inbound) and N **destination connectors** (outbound). Messages flow: `Source → PreProcess → Filter → Transform → [Destination1, Destination2, ...] → PostProcess`. This is clean and well-understood by Mirth users.

### 2. Connector = Protocol Adapter
Two roles: **Receiver** (source) and **Dispatcher** (destination). Two receive modes: **event-driven** (TCP, HTTP) and **poll-based** (File, Database). Each connector has its own properties schema.

### 3. Filter + Transformer Pipeline
Filters are ordered rules (AND/OR combinable) that accept/reject messages. Transformers are ordered steps that convert message content. Both compile to executable code. The separation of concerns is correct.

### 4. Message Lifecycle with Status Tracking
Messages progress through statuses: `RECEIVED → FILTERED | TRANSFORMED → SENT | QUEUED | ERROR`. Each connector gets its own `ConnectorMessage` with independent status. The parent `Message` tracks overall completion.

### 5. Channel Lifecycle State Machine
```
UNDEPLOYED → DEPLOYING → STARTED | STOPPED | PAUSED
STARTED → PAUSING → PAUSED
STARTED → STOPPING → STOPPED
PAUSED → STARTING → STARTED
STOPPED → STARTING → STARTED
{STARTED|PAUSED|STOPPED} → UNDEPLOYING → UNDEPLOYED
```

### 6. Destination Chains
Destinations can be chained (sequential) or independent (parallel). `waitForPrevious` controls this. Chains share a transaction context — if one destination fails, subsequent destinations in the chain are skipped.

### 7. Code Templates with Scoped Contexts
Reusable JS/TS functions scoped to specific pipeline stages (15 contexts from "Global Deploy" to "Destination Response Transformer"). Libraries group templates and associate them with specific channels.

### 8. Channel Dependencies (DAG)
Channels can declare dependencies on other channels. The deployment system uses a DAG to compute deploy/undeploy order with tiered parallel execution.

---

## What's Wrong with Connect (and What We Fix)

### Problem 1: Pervasive Mutability
**Connect:** Every model class is fully mutable via public setters. No `final` fields. `Channel.clone()` is explicitly documented as shallow.

**Mirthless:** All models are `readonly` by default. Zod schemas enforce structure at boundaries. Immutable by construction.

### Problem 2: No Type Safety on IDs
**Connect:** Channel IDs are `String`, User IDs are `Integer`, Message IDs are `Long`. Nothing prevents passing a channelId where a userId is expected.

**Mirthless:** Branded types: `ChannelId`, `ConnectorId`, `MessageId`, `UserId`. Factory functions with validation returning `Result<T>`.

### Problem 3: String-Typed Discriminators
**Connect:** `Connector.transportName` is a plain `String` ("TCP Sender", "HTTP Listener"). `Transformer.inboundDataType` is a string ("HL7V2"). No compile-time safety.

**Mirthless:** Discriminated unions with `as const` objects. Connector properties use TypeScript discriminated unions keyed by `type`.

### Problem 4: God Classes
**Connect:** `Channel.java` is 2,200 lines handling lifecycle, pipeline, queuing, and content management. `ConnectorMessage` has 30+ fields (8 content slots, 4 map slots, 3 error slots).

**Mirthless:** Decompose into focused modules: `ChannelLifecycle`, `MessageProcessor`, `QueueManager`, `ContentManager`. ConnectorMessage uses composition over flat fields.

### Problem 5: XML-Blob Storage
**Connect:** Channels, alerts, code templates stored as serialized XML TEXT blobs in the database. Querying, partial updates, and migration are painful. JSON is a second-class citizen (round-trips through XML).

**Mirthless:** Proper relational schema in Drizzle ORM. JSON is the native format. No XML serialization layer.

### Problem 6: No Authorization by Default
**Connect:** `DefaultAuthorizationController.isUserAuthorized()` always returns `true`. RBAC is a commercial plugin.

**Mirthless:** RBAC built into core from day one. Role-based permissions with channel-level access control. Based on fullstack-template auth patterns (JWT + sessions, bcrypt, PBKDF2).

### Problem 7: Rhino JavaScript Engine
**Connect:** Uses patched Mozilla Rhino with full Java interop. User scripts can access any Java class. No sandbox. Runs in interpreted mode for debugging.

**Mirthless:** Sandboxed JS/TS execution via `isolated-vm` or Node.js worker threads. TypeScript support with on-the-fly transpilation. Explicit API surface — no uncontrolled access to host runtime.

### Problem 8: Complex Thread Management
**Connect:** Manual thread pools, acceptor threads, reader threads, queue threads. Busy-wait polling for drain. `synchronized` blocks everywhere. The stop sequence for a channel is ~100 lines of careful thread coordination.

**Mirthless:** Node.js event loop + worker threads for CPU-bound work. `AbortController` for cancellation. Async/await instead of thread pools. `Promise.all` with bounded concurrency instead of `synchronized`.

### Problem 9: Tight Singleton Coupling
**Connect:** `Donkey.getInstance()`, `ControllerFactory.getFactory().createXxxController()`, `SqlConfig.getInstance()` everywhere. Circular controller dependencies. Untestable.

**Mirthless:** Dependency injection. Services receive their dependencies as constructor parameters. No singletons. Testable with mocks.

### Problem 10: No Input Validation
**Connect:** Zero validation in the model layer. Names can be null, IDs can be null, sequences can be anything.

**Mirthless:** Zod validation at every boundary. Domain models can only be constructed through validated factory functions returning `Result<T>`.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    packages/web                          │
│            React + MUI Admin Interface                   │
│   Dashboard │ Channel Editor │ Message Browser │ Users   │
└──────────────────────┬──────────────────────────────────┘
                       │ REST API (JSON)
┌──────────────────────┴──────────────────────────────────┐
│                   packages/server                        │
│              Express API + Auth (JWT/Sessions)           │
│  Routes → Controllers → Services → Drizzle ORM          │
└──────────┬──────────────────────────────┬───────────────┘
           │                              │
┌──────────┴──────────┐    ┌──────────────┴───────────────┐
│  packages/engine     │    │       PostgreSQL              │
│  Channel Runtime     │    │  ┌─────────┐ ┌────────────┐  │
│  Message Pipeline    │    │  │ Config  │ │ Messages   │  │
│  Queue Manager       │    │  │ DB      │ │ Store      │  │
│  Sandbox Executor    │    │  └─────────┘ └────────────┘  │
└──────────┬──────────┘    └──────────────────────────────┘
           │
┌──────────┴──────────────────────────────────────────────┐
│                 packages/connectors/*                     │
│  tcp-mllp │ http │ file │ database │ dicom │ js │ ...    │
└─────────────────────────────────────────────────────────┘
```

### Package Dependencies (DAG)

```
core-models  ←── core-util  ←── engine  ←── connectors/*
                                   ↑              ↑
                                server ───────────┘
                                   ↑
                                  web
                                   ↑
                                  cli
```

- `core-models` depends on nothing (pure types + Zod schemas)
- `core-util` depends on `core-models`
- `engine` depends on `core-models`, `core-util`
- `connectors/*` depend on `engine`, `core-models`
- `server` depends on `engine`, `connectors`, `core-models`, `core-util`
- `web` depends on `core-models` (shared types only)
- `cli` depends on `server` (API client)

---

## Message Pipeline (Redesigned)

```
Raw Message
    │
    ▼
┌─ Source Connector (Receiver) ─┐
│  TCP/MLLP, HTTP, File, DB... │
└───────────┬───────────────────┘
            │ dispatchRawMessage()
            ▼
┌─ PreProcessor ────────────────┐
│  JS/TS script (optional)      │
│  Transforms raw content       │
└───────────┬───────────────────┘
            │
            ▼
┌─ Source Filter ───────────────┐
│  Ordered rules (AND/OR)       │
│  Accept → continue            │
│  Reject → status = FILTERED   │
└───────────┬───────────────────┘
            │
            ▼
┌─ Source Transformer ──────────┐
│  Ordered steps (JS/TS)        │
│  Inbound format → Outbound    │
│  Sets encoded content         │
└───────────┬───────────────────┘
            │
            ▼
┌─ Destination Routing ─────────┐
│  Fan-out to N destinations    │
│  Parallel (independent) or    │
│  Sequential (chained)         │
└─┬──────┬──────┬───────────────┘
  │      │      │
  ▼      ▼      ▼
┌─ Per-Destination ─────────────┐
│  Filter → Transform           │
│  Send (via Dispatcher)        │
│  Response Transform           │
│  Queue on failure (optional)  │
└───────────┬───────────────────┘
            │
            ▼
┌─ PostProcessor ───────────────┐
│  JS/TS script (optional)      │
│  Access to all responses      │
└───────────────────────────────┘
```

### Key Differences from Connect

1. **No "donkey" naming** — just `engine`
2. **TypeScript transformers** — not just JavaScript
3. **Sandboxed execution** — isolated-vm or worker threads with explicit API
4. **Async-first** — pipeline stages are async with AbortController timeouts
5. **Result<T> throughout** — pipeline errors are values, not thrown exceptions
6. **Proper relational message storage** — not per-channel tables

---

## Connector Architecture (Redesigned)

### Interface

```typescript
interface SourceConnector {
  readonly type: ConnectorType;
  readonly properties: Readonly<SourceConnectorProperties>;
  onDeploy(): Promise<Result<void>>;
  onUndeploy(): Promise<Result<void>>;
  onStart(): Promise<Result<void>>;
  onStop(): Promise<Result<void>>;
  // Event-driven connectors call dispatchMessage() when messages arrive
  // Poll-based connectors implement poll() called on schedule
}

interface DestinationConnector {
  readonly type: ConnectorType;
  readonly properties: Readonly<DestinationConnectorProperties>;
  onDeploy(): Promise<Result<void>>;
  onUndeploy(): Promise<Result<void>>;
  onStart(): Promise<Result<void>>;
  onStop(): Promise<Result<void>>;
  send(message: ConnectorMessage): Promise<Result<Response>>;
}
```

### Connector Types (Priority Order)

| Priority | Connector | Source | Destination | Notes |
|---|---|---|---|---|
| P0 | TCP/MLLP | Listener | Sender | HL7v2 — core healthcare use case |
| P0 | Channel (VM) | Reader | Writer | Inter-channel routing |
| P1 | HTTP | Listener | Sender | REST/FHIR APIs |
| P1 | Database | Reader (poll) | Writer | SQL integration |
| P1 | File | Reader (poll) | Writer | Local + SFTP |
| P2 | JavaScript/TS | Reader (poll) | Writer | Custom logic escape hatch |
| P2 | DICOM | Listener | Sender | Wraps dcmtk.js |
| P3 | SMTP | — | Sender | Email notifications |
| P3 | FHIR | — | Client | FHIR R4 API |

### Transmission Mode Pattern (Keep)

Connect's separation of **transport** (TCP socket) from **framing** (MLLP start/end bytes) is elegant. We keep this:

```typescript
interface TransmissionMode {
  readonly name: string;
  createFrameHandler(stream: Readable): FrameHandler;
}

interface FrameHandler {
  readMessage(): AsyncGenerator<Buffer>;
  writeMessage(data: Buffer): Promise<void>;
}
```

Built-in modes: `mllp` (0x0B...0x1C0x0D), `raw` (no framing), `delimited` (custom delimiter).

---

## REST API Surface (Redesigned)

Connect has 15 API servlets with ~120 endpoints. We consolidate into Express route groups:

| Route Group | Key Endpoints | Notes |
|---|---|---|
| `/api/v1/channels` | CRUD, enable/disable, summary/diff sync | Proper relational, not XML blobs |
| `/api/v1/channels/:id/status` | start/stop/pause/resume/deploy/undeploy | Channel lifecycle control |
| `/api/v1/channels/:id/messages` | search, content, reprocess, delete, export | Message browser |
| `/api/v1/channels/:id/statistics` | get, clear | Per-channel and per-connector stats |
| `/api/v1/channel-groups` | CRUD | Logical grouping |
| `/api/v1/code-templates` | CRUD, libraries | With diff sync |
| `/api/v1/alerts` | CRUD, enable/disable | Alert management |
| `/api/v1/users` | CRUD, preferences | With RBAC |
| `/api/v1/auth` | login, logout, refresh, me | JWT + sessions |
| `/api/v1/config` | server settings, global scripts, tags, dependencies | Server configuration |
| `/api/v1/events` | search, export | Audit log |
| `/api/v1/system` | info, stats, health | System monitoring |
| `/api/v1/extensions` | list, enable/disable | Plugin management |

### Auth Model (From Scratch)

- JWT access tokens (15min) + refresh tokens (7 days) — from fullstack-template
- Session-backed with httpOnly cookies
- RBAC with roles and permissions (not Connect's always-true default)
- Channel-level access control built-in
- Rate limiting on auth endpoints
- Account lockout (keep from Connect)
- Password policy enforcement (keep from Connect)

---

## Data Storage (Redesigned)

### Config Database (Drizzle ORM)

Connect stores channels/alerts/templates as XML blobs. We use proper relational tables:

- `channels` — id, name, description, revision, enabled, initial_state, properties (JSONB)
- `connectors` — id, channel_id, name, mode, type, meta_data_id, enabled, wait_for_previous, properties (JSONB)
- `transformers` — id, connector_id, type (main/response), inbound_data_type, outbound_data_type
- `transformer_steps` — id, transformer_id, sequence, name, type, enabled, config (JSONB)
- `filters` — id, connector_id
- `filter_rules` — id, filter_id, sequence, name, type, operator, enabled, config (JSONB)
- `channel_scripts` — channel_id, script_type (deploy/undeploy/preprocess/postprocess), code
- `code_template_libraries` — id, name, revision, description, include_new_channels
- `code_templates` — id, library_id, name, type, code, context_set, revision
- `channel_groups` — id, name, revision
- `channel_tags` — id, name, color
- `channel_dependencies` — dependent_id, dependency_id
- `alerts` — id, name, enabled, trigger (JSONB), action_groups (JSONB)
- `users` — id, username, email, password_hash, role, is_active, etc.
- `sessions`, `roles`, `permissions`, `user_roles` — from fullstack-template
- `events` — audit log
- `server_settings` — key-value configuration
- `global_scripts` — deploy/undeploy/preprocessor/postprocessor

### Message Store

Per-channel message storage (Connect creates tables per channel — we use a single partitioned table):

- `messages` — id, channel_id, server_id, received_date, processed
- `connector_messages` — message_id, channel_id, meta_data_id, status, send_attempts, dates, error_code
- `message_content` — message_id, channel_id, meta_data_id, content_type, content, data_type, encrypted
- `message_metadata` — message_id, channel_id, meta_data_id, key, value
- `message_attachments` — message_id, channel_id, id, type, content

Partitioned by `channel_id` for query performance. BRIN index on `received_date`.

### Message Queuing

Postgres-backed with `SKIP LOCKED` for concurrent queue consumers:

```sql
SELECT * FROM connector_messages
WHERE channel_id = $1 AND meta_data_id = $2 AND status = 'QUEUED'
ORDER BY message_id
LIMIT $3
FOR UPDATE SKIP LOCKED
```

This replaces Connect's in-memory `LinkedHashMap` queue buffer backed by JDBC queries. Simpler, crash-safe, and leverages Postgres's MVCC.

---

## Transformer Sandbox (Redesigned)

### Requirements
1. Execute user-provided JS/TS code safely
2. Provide controlled API surface (message access, maps, logging, HTTP, DB)
3. Timeout enforcement (30s default)
4. No access to host filesystem, network (beyond provided APIs), or Node.js internals
5. TypeScript support with on-the-fly transpilation

### Approach: `isolated-vm` (Primary) or Worker Threads (Fallback)

**`isolated-vm`**: V8 isolates with separate heaps. True memory/CPU isolation. Can transfer data via structured clone. No access to Node.js APIs unless explicitly provided.

**Worker Threads**: Lighter isolation. Can share memory via SharedArrayBuffer. Easier to provide Node.js APIs. Less secure — user code could potentially access more than intended.

### API Exposed to User Code

```typescript
// Message access
msg        // Parsed inbound message (object)
tmp        // Outbound message being built
rawData    // Raw string content

// Maps (scoped key-value stores)
sourceMap       // Read-only, set by source connector
channelMap      // Read-write, shared across destinations
connectorMap    // Read-write, per-connector
responseMap     // Read-write, destination responses

// Utilities
logger          // Structured logging (info, warn, error)
$('key')        // Shorthand map lookup: responseMap → connectorMap → channelMap → sourceMap

// External access (controlled, async)
http.fetch(url, options)     // HTTP requests (with timeout)
db.query(sql, params)        // Database queries (parameterized only)
router.routeMessage(channelId, rawData)  // Inter-channel routing

// HL7 helpers
hl7.parse(raw)               // Parse HL7v2 message
hl7.createACK(msg, code)     // Generate ACK response
```

---

## Resolved Decisions

1. **Transformer sandbox: `isolated-vm`** — Use `isolated-vm` for V8 isolate-based sandboxing. Design the `SandboxExecutor` interface as a strong contract so the backing implementation is swappable if `isolated-vm` ever becomes unmaintained. The stripped-symbols issue on some Linux distros is mitigated by publishing official Docker images with Debian-based Node.js (symbols intact). Pin Node.js version in Docker image and test `isolated-vm` compatibility before Node upgrades.

2. **Message storage: partitioned single table from day one** — Single set of message tables (`messages`, `connector_messages`, `message_content`, etc.) partitioned by `channel_id` using Postgres declarative list partitioning. Partitions created/dropped at runtime when channels are created/deleted via raw SQL (`db.execute()`). Drizzle schema defines tables normally; partition DDL is in custom migrations. Queries work unchanged — Postgres handles partition routing transparently.

3. **Plugin API from day one** — Design runtime plugin discovery and loading from the start. Plugins are npm packages with a `mirthless` manifest in `package.json` (e.g., `@mirthless/connector-tcp-mllp`). Built-in connectors are just packages in the monorepo; third-party connectors install the same way. Pluggable surface: connectors, data types, transmission modes, and auth providers. Auth is pluggable to support OAuth2/OIDC, SAML, and LDAP down the road (v1 ships with local JWT auth only).

4. **Real-time UI: Socket.IO** — Use Socket.IO (from fullstack-template patterns) for real-time dashboard updates: channel status changes, statistics, log streaming. TanStack Query polling as fallback.

5. **Design for horizontal scaling** — v1 is single-process, but design the message store and channel state to support eventual multi-node deployment. Message tables include `server_id` column. Statistics are per-server and aggregated at query time. Channel state coordination will need a distributed lock or leader election mechanism when clustering is implemented.

6. **Plan for both HL7v2 and FHIR** — TCP/MLLP with HL7v2 is P0 (bread-and-butter). FHIR R4 connector is P2. Both get design attention; HL7v2 gets implementation priority.

7. **PostgreSQL only** — Mirth supports 5 database backends (Derby, PostgreSQL, MySQL, Oracle, SQL Server). We target PostgreSQL exclusively. This is a deliberate design choice that eliminates a massive surface area of multi-dialect SQL, ORM compatibility testing, and vendor-specific behavior. It enables us to use Postgres-specific features aggressively: list partitioning, SKIP LOCKED queues, LISTEN/NOTIFY, JSONB with GIN indexes, expression indexes, LZ4 TOAST compression. Drizzle ORM generates Postgres-specific SQL only. No abstraction layer for other databases.
