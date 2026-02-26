# 04 — Transformer Sandbox Design

> Safe execution of user-provided JS/TS code in filters, transformers, and scripts.

## The Problem

Users write arbitrary JavaScript/TypeScript that runs inside the integration engine. Connect uses Rhino (Mozilla's JS engine) with **zero sandboxing** — user scripts have full access to every Java class on the classpath. This is a massive security risk.

We need:
1. **Isolation** — User code cannot access the host filesystem, network, or Node.js internals
2. **Resource limits** — CPU timeout (30s default), memory limits
3. **Controlled API** — Explicit surface: message access, maps, logging, HTTP, DB
4. **TypeScript support** — Transpile TS on-the-fly before execution
5. **Performance** — HL7v2 messages at scale; overhead must be minimal

---

## Approach: `isolated-vm`

**Primary choice: `isolated-vm`** — V8 isolates with separate heaps.

### Why isolated-vm

- True memory isolation (separate V8 heap)
- CPU timeout enforcement (V8's built-in timeout)
- No access to Node.js APIs unless explicitly injected
- Fast data transfer via structured clone or reference handles
- Battle-tested (used by Cloudflare Workers' predecessor, Fly.io, etc.)

### Why NOT worker threads (for sandboxing)

- Worker threads share the same V8 isolate by default
- User code gets access to `require()`, `process`, `fs`, etc. unless carefully patched
- Harder to enforce memory limits
- Patching the global scope is error-prone and bypassable

Worker threads are still useful for **running the isolated-vm host** off the main event loop, preventing V8 compilation from blocking I/O.

---

## Architecture

```
Main Thread (Event Loop)
    │
    │ dispatchToSandbox(script, context)
    │
    ▼
Worker Thread Pool (N workers)
    │
    │ run isolated-vm Isolate
    │
    ▼
V8 Isolate (user code)
    │
    │  Injected API:
    │  - msg, tmp, rawData
    │  - sourceMap, channelMap, connectorMap, responseMap
    │  - $(), logger
    │  - __http_fetch(), __db_query(), __router_send()
    │
    │  These "bridge" functions call back to the
    │  worker thread which proxies to the main thread
    │
    ▼
Result (transformed content, map updates, logs)
```

### Lifecycle

1. **On channel deploy**: Create a pool of `isolated-vm.Isolate` instances (1 per processing thread). Pre-compile transformer/filter scripts. Pre-compile code template libraries.
2. **On message processing**: Acquire an isolate from the pool. Inject message context. Execute the pre-compiled script. Collect results. Return isolate to pool.
3. **On channel undeploy**: Dispose all isolates in the pool.

---

## TypeScript Support

User code can be written in TypeScript. We transpile to JavaScript before compilation into the isolate.

### Transpilation Pipeline

```
User TS Code
    │
    ▼
esbuild.transform(code, { loader: 'ts', target: 'es2022' })
    │
    ▼
JavaScript (ES2022)
    │
    ▼
isolated-vm Isolate.compileScript(js)
    │
    ▼
Pre-compiled Script (cached per channel deploy)
```

**Why esbuild**: 10-100x faster than `tsc` for transpilation. We only need type-stripping, not type-checking. Type errors are caught in the editor (Monaco in the web UI), not at runtime.

### Caching

Scripts are compiled once at channel deploy time and reused for every message. The compilation result (V8 compiled bytecode) is cached in the `ChannelRuntime`.

---

## API Surface (Injected into Isolate)

### Message Access

```typescript
// Available as globals in user scripts

msg: unknown;        // Parsed inbound message (JS object)
                     // HL7v2 → hierarchical object (PID, OBR, etc.)
                     // JSON → parsed object
                     // XML → JS object (via xml2js or similar)
                     // Raw → string

tmp: unknown;        // Outbound message being built
                     // Initialized as deep clone of msg (or empty based on outbound type)

rawData: string;     // The original raw message content (always a string)
```

### Maps (Scoped Key-Value Stores)

```typescript
sourceMap: Readonly<Record<string, unknown>>;      // Set by source connector, read-only
channelMap: Record<string, unknown>;               // Read-write, shared across all connectors in this message
connectorMap: Record<string, unknown>;             // Read-write, scoped to current connector
responseMap: Record<string, unknown>;              // Read-write, stores destination responses
globalChannelMap: Record<string, unknown>;         // Read-write, persists across messages for THIS channel (in-memory, cleared on undeploy)
globalMap: Record<string, unknown>;                // Read-write, persists across ALL channels and redeploys (stored in DB)
configMap: Readonly<Record<string, unknown>>;      // Read-only, admin-set key-value pairs from Settings

// Shorthand lookup: responseMap → connectorMap → channelMap → globalChannelMap → globalMap → configMap → sourceMap
function $(key: string): unknown;

// Response shortcuts
function $r(key: string): unknown;                    // Get from responseMap
function $r(key: string, value: unknown): void;       // Put into responseMap

// Global map shortcuts
function $g(key: string): unknown;                    // Get from globalMap
function $g(key: string, value: unknown): void;       // Put into globalMap

// Global channel map shortcuts
function $gc(key: string): unknown;                   // Get from globalChannelMap
function $gc(key: string, value: unknown): void;      // Put into globalChannelMap
```

### Destination Routing Control

Available only in the **source transformer** context. Allows scripts to programmatically control which destinations receive the current message.

```typescript
// Available as a global in source transformer scripts only
const destinationSet: {
  removeAll(): void;                              // Remove all destinations
  remove(connectorName: string): void;            // Remove a specific destination by name
  removeAllExcept(connectorName: string): void;   // Keep only the named destination
  add(connectorName: string): void;               // Re-add a previously removed destination
  contains(connectorName: string): boolean;       // Check if destination is in set
  getConnectorNames(): ReadonlyArray<string>;     // List current destinations
};
```

Initialized with all enabled destinations. After the source transformer completes, only destinations still in the set are processed. If `destinationSet` is empty, the message is still marked as TRANSFORMED but no destinations execute.

```typescript
// Example: Route ADT messages only to the ADT destination
destinationSet.removeAll();
if (msg.MSH?.MSH9?.MSH91 === 'ADT') {
  destinationSet.add('ADT Processor');
} else {
  destinationSet.add('Default Router');
}
```

---

### Logging

```typescript
const logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
};
```

Logs are buffered during execution and flushed after the script completes, tagged with channelId + messageId + connectorName.

### External Access (Async Bridges)

These are **synchronous wrappers** around async operations. The isolate calls a bridge function that suspends execution, the worker thread performs the I/O, and the result is returned synchronously to the isolate.

```typescript
// HTTP requests (controlled — timeout enforced, no access to internal network)
function httpFetch(url: string, options?: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}): { status: number; body: string; headers: Record<string, string> };

// Database queries (parameterized only — no raw SQL injection)
function dbQuery(
  driver: string,
  url: string,
  sql: string,
  params?: unknown[],
): unknown[];

// Inter-channel routing
function routeMessage(
  channelName: string,
  rawData: string,
): { messageId: string; status: string };

// HL7 helpers
function createACK(originalMessage: unknown, ackCode: string): string;
function parseHL7(raw: string): unknown;

// Resource file access (read-only)
function getResource(name: string): string;           // Read uploaded resource file content
```

### Global Map Persistence

The `globalMap` is shared across all channels and persists across message processing and channel redeploys. It is stored in the database and loaded into memory at server startup.

```typescript
// Host-side implementation
class GlobalMapService {
  private cache = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    if (this.cache.has(key)) return this.cache.get(key);
    const row = await this.db.select().from(globalMapEntries).where(eq(globalMapEntries.key, key));
    const value = row?.[0]?.value ? JSON.parse(row[0].value) : undefined;
    this.cache.set(key, value);
    return value;
  }

  async put(key: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value);
    await this.db.insert(globalMapEntries)
      .values({ key, value: serialized })
      .onConflictDoUpdate({ target: globalMapEntries.key, set: { value: serialized, updatedAt: new Date() } });
    this.cache.set(key, value);
  }
}
```

Writes are debounced (flushed every 1s) to avoid excessive DB writes when scripts update the global map frequently. Server setting `clearGlobalMap` controls whether the map is cleared on server restart.

### Configuration Map

The `configMap` is a read-only key-value store set by administrators in the Settings page. Unlike `globalMap`, it cannot be modified by user scripts. Use cases: environment-specific URLs, API keys, feature flags shared across all channels.

```typescript
// Loaded once at server startup and on settings change
const configMap = await configService.getAll('runtime');
// Injected read-only into every sandbox context
```

### Global Channel Map

The `globalChannelMap` is a per-channel key-value store that persists across messages but is scoped to a single channel. Unlike `globalMap` (cross-channel, DB-backed), `globalChannelMap` is in-memory only and cleared when the channel is undeployed.

| Map | Scope | Lifetime | Storage |
|---|---|---|---|
| `channelMap` | Single message | Message processing | Stored per-message in DB |
| `globalChannelMap` | Single channel | Channel uptime (deploy → undeploy) | In-memory only |
| `globalMap` | All channels | Server uptime (persists across redeploys) | DB-backed |
| `configMap` | All channels | Server uptime (read-only) | DB-backed |

```typescript
// Host-side implementation — one instance per ChannelRuntime
class GlobalChannelMapService {
  private readonly store = new Map<string, unknown>();

  get(key: string): unknown { return this.store.get(key); }
  put(key: string, value: unknown): void { this.store.set(key, value); }
  clear(): void { this.store.clear(); } // Called on undeploy
}
```

Use cases: caching parsed lookup tables, tracking per-channel counters, storing connection state between messages.

---

### Implementation: Sync Bridges via `isolated-vm` Callbacks

```typescript
// In the worker thread (host side):
const context = isolate.createContextSync();

// Inject a synchronous callback that the isolate can call
context.evalClosureSync(
  `globalThis.httpFetch = function(url, options) {
    return $0.applySyncPromise(undefined, [url, JSON.stringify(options)]);
  }`,
  [
    new ivm.Callback((url: string, optionsJson: string) => {
      const options = JSON.parse(optionsJson);
      // This runs in the worker thread — can do async I/O
      return fetch(url, options).then(r => ({
        status: r.status,
        body: r.text(),
        headers: Object.fromEntries(r.headers.entries()),
      }));
    }),
  ],
);
```

---

## Filter Execution

Filters compile to a boolean expression:

```typescript
async executeFilter(
  filter: Filter,
  context: SandboxContext,
  options: ExecutionOptions,
): Promise<Result<{ filtered: boolean }>> {
  if (filter.rules.length === 0) {
    return { ok: true, value: { filtered: false } }; // No rules = accept all
  }

  // Compile rules into a single JS function
  const script = compileFilterRules(filter.rules);

  const result = await this.execute(script, context, options);
  if (!result.ok) return result;

  return { ok: true, value: { filtered: !result.value } }; // Filter returns true = accept
}
```

### Rule Compilation

```typescript
function compileFilterRules(rules: ReadonlyArray<FilterRule>): string {
  const parts: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const ruleScript = rule.type === 'JAVASCRIPT'
      ? `(function() { ${rule.script} })()`
      : compileRuleBuilder(rule);

    if (parts.length === 0) {
      parts.push(ruleScript);
    } else {
      const op = rule.operator === 'AND' ? '&&' : '||';
      parts.push(`${op} ${ruleScript}`);
    }
  }

  return `(function() { return ${parts.join(' ')}; })()`;
}
```

---

## Transformer Execution

```typescript
async executeTransformer(
  transformer: Transformer,
  context: SandboxContext,
  options: ExecutionOptions,
): Promise<Result<{ encoded: string; maps: MessageMaps }>> {
  // Parse inbound message based on data type
  const parsed = parseMessage(context.raw, transformer.inboundDataType);

  // Set up msg and tmp
  const sandboxContext = {
    ...context,
    msg: parsed,
    tmp: initializeOutbound(transformer.outboundDataType),
  };

  // Execute each enabled step in sequence
  for (const step of transformer.steps) {
    if (!step.enabled) continue;

    const stepScript = compileTransformerStep(step);
    const result = await this.execute(stepScript, sandboxContext, options);
    if (!result.ok) return result;
  }

  // Serialize outbound based on data type
  const encoded = serializeMessage(sandboxContext.tmp, transformer.outboundDataType);

  return {
    ok: true,
    value: { encoded, maps: extractMaps(sandboxContext) },
  };
}
```

---

## Resource Limits

```typescript
interface ExecutionOptions {
  readonly timeout: number;          // Default: 30_000ms
  readonly memoryLimit: number;      // Default: 128MB per isolate
  readonly signal: AbortSignal;      // For external cancellation
}

// On Isolate creation:
const isolate = new ivm.Isolate({
  memoryLimit: 128,  // MB
});

// On script execution:
const result = await script.run(context, {
  timeout: options.timeout,
  // V8 will throw if the script exceeds the timeout
});
```

---

## Code Template Integration

Code templates are injected into the isolate's global scope before user scripts run:

```typescript
function injectCodeTemplates(
  context: ivm.Context,
  templates: ReadonlyArray<CodeTemplate>,
  currentContext: CodeTemplateContext,
): void {
  for (const template of templates) {
    if (!template.contexts.has(currentContext)) continue;

    // Inject as global function
    context.evalSync(template.code);
  }
}
```

Templates of type `FUNCTION` define named functions. Templates of type `CODE_BLOCK` are inlined at the call site.

---

## Worker Thread Pool

The sandbox runs in a fixed-size worker thread pool to avoid blocking the main event loop:

```typescript
class SandboxPool {
  private readonly workers: Worker[];
  private readonly available: Worker[];
  private readonly waiting: Array<(worker: Worker) => void>;

  constructor(size: number) {
    this.workers = Array.from({ length: size }, () =>
      new Worker('./sandbox-worker.js')
    );
    this.available = [...this.workers];
    this.waiting = [];
  }

  async acquire(): Promise<Worker> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release(worker: Worker): void {
    const next = this.waiting.shift();
    if (next) { next(worker); }
    else { this.available.push(worker); }
  }
}
```

Default pool size: `os.cpus().length - 1` (leave 1 core for the event loop).

---

## Script Execution Contexts

Every script type runs in the sandbox with a specific set of available variables. This table is the definitive reference for what's injected into each context.

### Global Scripts

| Script | When | Available Variables | Return Value |
|---|---|---|---|
| **Global Deploy** | Once per channel at server startup / redeploy | `globalMap`, `configMap`, `channelId`, `channelName`, `logger` | None (void) |
| **Global Undeploy** | Once per channel at server shutdown / undeploy | `globalMap`, `configMap`, `channelId`, `channelName`, `logger` | None (void) |
| **Global Preprocessor** | Before every message on every channel, before channel preprocessor | `message` (raw string), `channelId`, `channelName`, `sourceMap`, `globalMap`, `globalChannelMap`, `configMap`, `logger` | Modified raw string (replaces message content) or `undefined` (no change) |
| **Global Postprocessor** | After every message on every channel, after channel postprocessor | `message` (raw string), `channelId`, `channelName`, `messageId`, `responseMap`, `channelMap`, `sourceMap`, `globalMap`, `globalChannelMap`, `configMap`, `logger` | None (void) |

### Channel Scripts

| Script | When | Available Variables | Return Value |
|---|---|---|---|
| **Channel Deploy** | When the channel deploys | `globalMap`, `globalChannelMap`, `configMap`, `channelId`, `channelName`, `logger` | None (void) |
| **Channel Undeploy** | When the channel undeploys | `globalMap`, `globalChannelMap`, `configMap`, `channelId`, `channelName`, `logger` | None (void) |
| **Channel Preprocessor** | Before each message, after global preprocessor | `message` (raw string), `channelId`, `sourceMap`, `globalMap`, `globalChannelMap`, `configMap`, `logger` | Modified raw string or `undefined` |
| **Channel Postprocessor** | After all destinations complete | `message` (raw string), `messageId`, `channelId`, `responseMap`, `channelMap`, `sourceMap`, `globalMap`, `globalChannelMap`, `configMap`, `connectorMap`, `logger` | Response string (when responseMode is POSTPROCESSOR) or void |
| **Attachment Script** | After receive, before filter | `rawData` (string), `channelId`, `logger` | `AttachmentResult` (see Attachment Handler) |
| **Batch Script** | When batch mode enabled, before splitting | `message` (raw string), `channelId`, `logger` | `ReadonlyArray<string>` (individual messages) |

### Filter/Transformer Scripts

| Script | When | Available Variables | Return Value |
|---|---|---|---|
| **Source Filter** | After preprocessor | `msg`, `rawData`, `sourceMap`, `channelMap`, `globalChannelMap`, `globalMap`, `configMap`, `logger`, `destinationSet` | `boolean` (true = accept, false = filter) |
| **Source Transformer** | After source filter passes | `msg`, `tmp`, `rawData`, `sourceMap`, `channelMap`, `connectorMap`, `globalChannelMap`, `globalMap`, `configMap`, `logger`, `destinationSet` | Modifies `tmp` in place |
| **Destination Filter** | Per destination | `msg`, `rawData`, `sourceMap`, `channelMap`, `connectorMap`, `globalChannelMap`, `globalMap`, `configMap`, `logger` | `boolean` |
| **Destination Transformer** | Per destination, after filter | `msg`, `tmp`, `rawData`, `sourceMap`, `channelMap`, `connectorMap`, `globalChannelMap`, `globalMap`, `configMap`, `responseMap`, `logger` | Modifies `tmp` in place |
| **Response Transformer** | After destination send | `msg` (response), `responseMap`, `channelMap`, `connectorMap`, `globalChannelMap`, `globalMap`, `configMap`, `logger` | Modifies response in place |

### Connector Scripts

| Script | When | Available Variables | Return Value |
|---|---|---|---|
| **JavaScript Reader** | On poll interval | `globalMap`, `globalChannelMap`, `configMap`, `logger`, `httpFetch`, `dbQuery` | Raw message string |
| **JavaScript Writer** | On destination send | `msg`, `rawData`, `channelMap`, `connectorMap`, `globalChannelMap`, `globalMap`, `configMap`, `responseMap`, `logger`, `httpFetch`, `dbQuery`, `routeMessage` | Response string |

All scripts also have access to bridge functions (`httpFetch`, `dbQuery`, `routeMessage`, `createACK`, `parseHL7`, `getResource`) and the shorthand lookups (`$()`, `$r()`, `$g()`, `$gc()`).

---

## Resolved Decisions

1. **isolated-vm with swappable SandboxExecutor contract** — Use `isolated-vm` as the initial implementation. Design the `SandboxExecutor` interface as a strong contract so the backing implementation can be swapped if `isolated-vm` becomes unmaintained. Docker images use Debian-based Node.js (symbols intact). Pin Node.js version and test compatibility before upgrades. See `00-architecture-overview.md` Resolved Decision #1 for full rationale.

2. **Sync bridge performance: mitigated by worker pool** — `applySyncPromise` blocks the isolate's worker thread, not the main event loop. The shared worker thread pool (from `02-engine.md` decision #2) ensures other messages continue processing on other workers. Combined with per-channel backpressure limits (`maxConcurrentMessages`), pool exhaustion from I/O-heavy scripts is controlled. No additional design needed beyond the existing pool + backpressure architecture.

3. **Parser libraries bundled inside the isolate** — Parse HL7v2, XML, and other formats inside the isolate to avoid serialization boundary costs. Bundled libraries pre-loaded into every isolate at deploy time:
   - **HL7v2 parser** — parse/build HL7v2 messages (equivalent to Connect's built-in handling)
   - **XML library** — `fast-xml-parser` or similar (function-call API, no E4X/JSX syntax — we do not support Connect's native XML syntax as it would require Babel)
   - **JSON** — built into V8
   - **FHIR helpers** — basic resource construction/validation (later phase)

   Libraries are compiled once at channel deploy time and reused across all message executions.

4. **In-browser debugging via V8 Inspector Protocol (P2/P3)** — Major differentiator over Connect (whose "debugger" is IDE-based and breaks in Docker). Approach: `isolated-vm` supports V8 Inspector attachment per isolate. Monaco Editor in the web UI connects via WebSocket bridge to the isolate's inspector. Users get breakpoints, step-through, and variable inspection directly in the browser. The `SandboxExecutor` interface includes a `debug?: boolean` flag from day one to support this. Full UX design deferred to implementation phase.

5. **Source maps for TypeScript stack traces** — esbuild generates source maps during transpilation. Store the source map alongside the compiled script in the `ChannelRuntime`. On error, map stack traces back to original TypeScript line numbers using the stored source map before surfacing errors to the user (in logs, message browser error details, and the debugger).
