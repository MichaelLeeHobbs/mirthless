# 02 — Engine Design

> Message processing pipeline, channel lifecycle, queuing, and recovery.

## What Connect Does

Connect's "Donkey" engine is a ~2,200 line god class (`Channel.java`) that handles:
- Channel lifecycle (deploy/undeploy/start/stop/halt/pause/resume)
- Message pipeline (receive → filter → transform → route → send)
- Source and destination queuing with in-memory buffers
- Message recovery after crash
- Content removal policies
- Statistics coordination

The engine uses Java threads extensively: acceptor threads, reader threads, queue threads, destination chain threads — all manually managed with `synchronized` blocks and busy-wait polling.

## Our Redesign

### Principles

1. **Async/await over threads** — Node.js event loop for I/O, worker threads only for CPU-bound sandbox execution
2. **Decomposed classes** — No god classes. Separate: `ChannelRuntime`, `MessageProcessor`, `QueueManager`, `RecoveryManager`
3. **Result<T> throughout** — Pipeline errors are values, not exceptions
4. **AbortController for cancellation** — No busy-wait polling
5. **Postgres SKIP LOCKED for queuing** — No in-memory queue buffer; the database IS the queue

---

## Channel Lifecycle

### State Machine

```
                   deploy()
  UNDEPLOYED ─────────────────► DEPLOYING ──► STOPPED
                                                │
                              start()           │
                   ◄────────────────────────────┘
                   │
                   ▼
                STARTING ──────────────────► STARTED
                                               │  │
                              pause()          │  │ stop()
                   ◄──────────────────────────┘  │
                   │                              │
                   ▼                              ▼
                PAUSING ──► PAUSED          STOPPING ──► STOPPED
                              │                              │
                   start()    │            undeploy()        │
                   ◄──────────┘            ◄─────────────────┘
                                           │
                                           ▼
                                      UNDEPLOYING ──► UNDEPLOYED
```

### ChannelRuntime

```typescript
class ChannelRuntime {
  readonly channelId: ChannelId;
  private state: ChannelState;
  private readonly sourceConnector: SourceConnectorRuntime;
  private readonly destinationConnectors: ReadonlyMap<MetaDataId, DestinationConnectorRuntime>;
  private readonly processor: MessageProcessor;
  private readonly queueManager: QueueManager;
  private readonly abortController: AbortController;

  async deploy(config: Channel): Promise<Result<void>>;
  async undeploy(): Promise<Result<void>>;
  async start(): Promise<Result<void>>;
  async stop(): Promise<Result<void>>;
  async halt(): Promise<Result<void>>;  // Force stop (aborts in-flight)
  async pause(): Promise<Result<void>>; // Stops source only
  async resume(): Promise<Result<void>>;
  getState(): ChannelState;
  getStatistics(): ChannelStatistics;
}
```

### Deploy Sequence

1. Validate channel configuration (Zod)
2. Initialize source connector (`onDeploy()`)
3. Initialize destination connectors (`onDeploy()` for each)
4. Load code template libraries enabled for this channel, filtered by context (source filter, source transformer, destination filter, etc.). Pre-compile via esbuild and cache compiled bytecode in `ChannelRuntime`
5. Load and pre-compile filter/transformer scripts into sandbox
6. Initialize queue manager (create Postgres advisory locks if needed)
7. Load statistics from database
8. Emit `DEPLOYED` event

**Code template lifecycle:** When a code template library is updated, all channels that reference it must be redeployed to pick up changes. The server emits a `TEMPLATE_UPDATED` event; the web admin shows affected channels with a "needs redeploy" indicator.

### Start Sequence

1. Set state to `STARTING`
2. Start destination connectors (open connections, start queue consumers)
3. Run recovery (process unfinished messages from last shutdown)
4. Start source connector (begin accepting messages)
5. Set state to `STARTED`

### Stop Sequence (Graceful)

1. Set state to `STOPPING`
2. Stop source connector (stop accepting new messages)
3. Wait for in-flight messages to complete (with timeout via AbortController)
4. Stop destination queue consumers
5. Stop destination connectors
6. Set state to `STOPPED`

### Halt Sequence (Forced)

1. Abort the AbortController (cancels all in-flight operations)
2. Stop source connector immediately
3. Stop all destination connectors immediately
4. Set state to `STOPPED`

---

## Message Pipeline

### MessageProcessor

```typescript
class MessageProcessor {
  constructor(
    private readonly channelId: ChannelId,
    private readonly sourceConnector: SourceConnectorRuntime,
    private readonly destinations: ReadonlyMap<MetaDataId, DestinationConnectorRuntime>,
    private readonly sandbox: SandboxExecutor,
    private readonly dao: MessageDao,
    private readonly config: Channel,
  ) {}

  async processMessage(raw: RawMessage, signal: AbortSignal): Promise<Result<ProcessedMessage>>;
}
```

### Pipeline Flow

```typescript
async processMessage(raw: RawMessage, signal: AbortSignal): Promise<Result<ProcessedMessage>> {
  // 1. Create and store source message
  const message = await this.dao.createMessage(this.channelId, raw);
  const sourceMsg = await this.dao.createConnectorMessage(message.id, 0, 'RECEIVED', raw.content);

  // 2. Run preprocessor
  const preprocessResult = await this.sandbox.execute(
    this.config.scripts.preprocessor,
    { raw: sourceMsg.content.raw, sourceMap: raw.sourceMap },
    { timeout: 30_000, signal },
  );
  if (!preprocessResult.ok) {
    await this.dao.updateStatus(sourceMsg, 'ERROR', preprocessResult.error);
    return preprocessResult;
  }

  // 3. Source filter
  const filterResult = await this.sandbox.executeFilter(
    this.config.sourceConnector.filter,
    { msg: preprocessResult.value, sourceMap: raw.sourceMap },
    { timeout: 30_000, signal },
  );
  if (!filterResult.ok) {
    await this.dao.updateStatus(sourceMsg, 'ERROR', filterResult.error);
    return filterResult;
  }
  if (filterResult.value.filtered) {
    await this.dao.updateStatus(sourceMsg, 'FILTERED');
    return { ok: true, value: { messageId: message.id, status: 'FILTERED' } };
  }

  // 4. Source transformer
  const transformResult = await this.sandbox.executeTransformer(
    this.config.sourceConnector.transformer,
    { msg: preprocessResult.value, sourceMap: raw.sourceMap },
    { timeout: 30_000, signal },
  );
  if (!transformResult.ok) {
    await this.dao.updateStatus(sourceMsg, 'ERROR', transformResult.error);
    return transformResult;
  }
  await this.dao.updateStatus(sourceMsg, 'TRANSFORMED');

  // 5. Apply destinationSet (programmatic routing from source transformer)
  // The sandbox returns which destinations were kept/removed by user scripts
  const activeDestinations = this.applyDestinationSet(
    transformResult.value.destinationSet, // Set<string> of connector names
  );

  // 6. Route to active destinations (parallel or chained)
  const destinationResults = await this.routeToDestinations(
    message, transformResult.value.encoded, raw.sourceMap, signal, activeDestinations,
  );

  // 7. Postprocessor
  const postprocessorResult = await this.sandbox.execute(
    this.config.scripts.postprocessor,
    { message, responses: destinationResults },
    { timeout: 30_000, signal },
  );

  // 8. Mark message as processed
  await this.dao.markProcessed(message.id);

  return { ok: true, value: { messageId: message.id, status: 'SENT' } };
}

// Response mode determines WHEN and WHAT the source connector sends back
// to the original sender. This is separate from the pipeline processing.
//
// | Mode                    | When response is sent            | Response content                |
// |-------------------------|----------------------------------|---------------------------------|
// | NONE                    | Never                            | N/A                             |
// | AUTO_BEFORE             | Immediately on receive           | Auto-generated ACK              |
// | AUTO_AFTER_TRANSFORMER  | After source transformer         | Auto-generated ACK              |
// | AUTO_AFTER_DESTINATIONS | After all destinations complete  | Auto-generated ACK              |
// | POSTPROCESSOR           | After postprocessor              | Postprocessor return value      |
// | DESTINATION             | After named destination completes| That destination's response     |
//
// For AUTO modes with HL7v2, the ACK is generated from the original MSH segment.
// The responseMode is set on SourceConnector (see 01-core-models.md).
// The source connector runtime holds the reply handle and sends the response
// at the appropriate pipeline stage.
```

### Destination Routing

```typescript
private async routeToDestinations(
  message: Message,
  encodedContent: string,
  sourceMap: Record<string, unknown>,
  signal: AbortSignal,
): Promise<ReadonlyArray<DestinationResult>> {
  // Group destinations into chains (sequential) and independents (parallel)
  const { chains, independents } = this.groupDestinations();

  // Execute chains sequentially within each chain, chains parallel to each other
  const chainPromises = chains.map((chain) =>
    this.executeChain(message, chain, encodedContent, sourceMap, signal),
  );

  // Execute independents in parallel
  const independentPromises = independents.map((dest) =>
    this.executeDestination(message, dest, encodedContent, sourceMap, signal),
  );

  // Use Promise.all with bounded concurrency (p-limit)
  const results = await Promise.all([...chainPromises, ...independentPromises]);
  return results.flat();
}
```

---

## Source Queue

When the channel's `responseMode` is `AUTO_BEFORE`, the source connector decouples receive from processing:

1. Source receives raw message
2. Source stores message in DB with status `RECEIVED`
3. Source **immediately** generates and sends the ACK response (before any pipeline processing)
4. Message enters the processing pipeline asynchronously

This is the "source queue" concept. The `processingThreads` setting on the source connector controls how many messages can be processed concurrently from this queue. Incoming messages that arrive while all processing threads are busy wait in the DB (status `RECEIVED`) until a thread is available.

When `responseMode` is anything other than `AUTO_BEFORE`, processing is synchronous — the source connector holds the connection/request open until the pipeline stage indicated by `responseMode` completes, then sends the response.

```typescript
// In SourceConnectorRuntime:
async onMessage(raw: RawMessage): Promise<Result<string | null>> {
  // Store immediately
  const message = await this.dao.createMessage(this.channelId, raw);

  if (this.config.responseMode === 'AUTO_BEFORE') {
    // Generate ACK immediately, don't wait for pipeline
    const ack = this.generateAutoResponse(raw);
    // Queue for async processing via the channel's processing limiter
    this.processingLimiter(() => this.processor.processMessage(message, this.signal));
    return { ok: true, value: ack };
  }

  // Synchronous: process and wait for the configured response stage
  const result = await this.processor.processMessage(message, this.signal);
  return this.buildResponse(result, raw);
}
```

---

## Destination Queue Manager

### Postgres-Backed Queue (SKIP LOCKED)

Connect uses an in-memory `LinkedHashMap` buffer backed by JDBC queries. This is complex and loses messages on crash. We use Postgres directly.

```typescript
class QueueManager {
  constructor(private readonly db: DrizzleClient) {}

  // Enqueue: just update status to QUEUED
  async enqueue(connectorMessage: ConnectorMessage): Promise<Result<void>> {
    return tryCatch(
      this.db.update(connectorMessages)
        .set({ status: 'QUEUED' })
        .where(eq(connectorMessages.id, connectorMessage.id))
    );
  }

  // Dequeue: SELECT ... FOR UPDATE SKIP LOCKED
  async dequeue(
    channelId: ChannelId,
    metaDataId: MetaDataId,
    batchSize: number,
  ): Promise<Result<ReadonlyArray<ConnectorMessage>>> {
    return tryCatch(
      this.db.execute(sql`
        SELECT * FROM connector_messages
        WHERE channel_id = ${channelId}
          AND meta_data_id = ${metaDataId}
          AND status = 'QUEUED'
        ORDER BY message_id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `)
    );
  }

  // Release: update status to SENT, ERROR, etc.
  async release(
    connectorMessage: ConnectorMessage,
    newStatus: MessageStatus,
  ): Promise<Result<void>>;
}
```

### Queue Consumer

Each destination with queuing enabled runs a consumer loop:

```typescript
class QueueConsumer {
  private running = false;
  private readonly abortController = new AbortController();

  async start(
    channelId: ChannelId,
    metaDataId: MetaDataId,
    destination: DestinationConnectorRuntime,
    config: DestinationConnectorProperties,
  ): Promise<void> {
    this.running = true;

    while (this.running) {
      const messages = await this.queueManager.dequeue(channelId, metaDataId, 1);

      if (!messages.ok || messages.value.length === 0) {
        // Empty queue — wait before polling again
        await sleep(config.queuePollIntervalMs ?? 1000, this.abortController.signal);
        continue;
      }

      for (const msg of messages.value) {
        const result = await destination.send(msg);
        if (result.ok) {
          await this.queueManager.release(msg, 'SENT');
        } else {
          // Retry or error based on config
          if (msg.sendAttempts < config.retryCount) {
            await this.dao.incrementSendAttempts(msg);
            await sleep(config.retryIntervalMs, this.abortController.signal);
          } else {
            await this.queueManager.release(msg, 'ERROR');
          }
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController.abort();
  }
}
```

---

## Recovery

On channel start, process any messages left in intermediate states from a previous crash:

1. **RECEIVED source messages** — Re-run from the beginning of the pipeline
2. **RECEIVED destination messages** — Re-run filter/transform/send for that destination
3. **PENDING messages** — Re-run the response transformer
4. **QUEUED messages** — Queue consumers will pick these up automatically

```typescript
class RecoveryManager {
  async recover(channelId: ChannelId): Promise<Result<RecoveryReport>> {
    // Find unfinished messages
    const unfinished = await this.dao.findUnfinishedMessages(channelId);

    for (const msg of unfinished) {
      // Route to appropriate recovery path based on status
      if (msg.status === 'RECEIVED' && msg.metaDataId === 0) {
        await this.processor.processMessage(msg.raw, this.signal);
      } else if (msg.status === 'RECEIVED') {
        await this.processor.processDestination(msg, this.signal);
      } else if (msg.status === 'PENDING') {
        await this.processor.processResponseTransformer(msg, this.signal);
      }
      // QUEUED messages are handled by QueueConsumer
    }

    return { ok: true, value: { recovered: unfinished.length } };
  }
}
```

---

## Statistics

Per-channel and per-connector statistics, accumulated in memory and flushed periodically:

```typescript
interface ChannelStatistics {
  readonly channelId: ChannelId;
  readonly received: number;
  readonly filtered: number;
  readonly sent: number;
  readonly errored: number;
  readonly queued: number;
  readonly connectorStats: ReadonlyMap<MetaDataId, ConnectorStatistics>;
}

class StatisticsCollector {
  private pending = new Map<string, number>(); // channelId:metaDataId:status → count
  private flushInterval: NodeJS.Timeout;

  increment(channelId: ChannelId, metaDataId: MetaDataId, status: MessageStatus): void {
    const key = `${channelId}:${metaDataId}:${status}`;
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
  }

  // Flush to database every N seconds
  private async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = new Map();
    await this.dao.batchUpdateStatistics(batch);
  }
}
```

---

## Data Pruner

Background service that prunes old messages per channel configuration.

```typescript
class DataPruner {
  private schedule: CronJob;

  async start(cronExpression: string): Promise<void> {
    // Default: daily at 3am — configurable in server settings
    this.schedule = new CronJob(cronExpression ?? '0 3 * * *', () => this.run());
    this.schedule.start();
  }

  private async run(): Promise<Result<PruneReport>> {
    const channels = await this.channelService.getAll();
    const report: PruneReport = { pruned: 0, errors: [] };

    for (const channel of channels) {
      if (!channel.pruningEnabled || !channel.pruningMaxAgeDays) continue;

      const result = await this.pruneChannel(channel.id, channel.pruningMaxAgeDays);
      if (result.ok) {
        report.pruned += result.value;
      } else {
        report.errors.push({ channelId: channel.id, error: result.error });
      }
    }

    // Emit event for audit log
    await this.eventService.create({
      level: 'INFO',
      name: 'Data pruner completed',
      attributes: { pruned: report.pruned, errors: report.errors.length },
    });

    return { ok: true, value: report };
  }

  private async pruneChannel(channelId: ChannelId, maxAgeDays: number): Promise<Result<number>> {
    // Archive if configured, then delete
    const cutoff = sql`NOW() - INTERVAL '${maxAgeDays} days'`;
    const result = await this.db.execute(sql`
      DELETE FROM messages
      WHERE channel_id = ${channelId} AND received_at < ${cutoff}
    `);
    return { ok: true, value: result.rowCount };
  }
}
```

Server settings: `prunerCronExpression`, `prunerBatchSize` (rows per DELETE), `prunerEnabled`.

---

## Batch Message Processing

Source connectors can receive payloads containing multiple messages (e.g., a file with 100 HL7 messages, a database query returning 50 rows). The batch processor splits the payload into individual messages and feeds each into the pipeline.

```typescript
interface BatchProcessor {
  split(content: string, options: BatchOptions): ReadonlyArray<string>;
}

const BATCH_TYPE = {
  SPLIT_BY_DELIMITER: 'SPLIT_BY_DELIMITER', // Split on \n, \r, custom delimiter
  SPLIT_BY_REGEX: 'SPLIT_BY_REGEX',         // Split on regex pattern
  SPLIT_BY_JAVASCRIPT: 'SPLIT_BY_JAVASCRIPT', // User script returns array
} as const;

interface BatchOptions {
  readonly type: typeof BATCH_TYPE[keyof typeof BATCH_TYPE];
  readonly delimiter?: string;    // For SPLIT_BY_DELIMITER
  readonly pattern?: string;      // For SPLIT_BY_REGEX
  readonly script?: string;       // For SPLIT_BY_JAVASCRIPT
}
```

The source connector's `dispatchMessage` is called once per split message. Each becomes an independent message in the pipeline with its own message ID and lifecycle.

Batch processing is configured on the source connector and applies to all poll-based connectors (File, Database, JavaScript). Event-driven connectors (TCP, HTTP) typically receive one message per connection/request but can opt in to batch mode.

**Batch response aggregation:** When batch mode is enabled and `responseMode` is not `AUTO_BEFORE`, the source connector collects individual responses from each split message. The aggregate response is the last message's response (or the first error response, if any message errored). For HL7 batch files (FHS/BHS envelope), the aggregate response is an HL7 batch ACK.

---

## Attachment Handler

Configurable per channel. Extracts binary or large content from messages before pipeline processing.

```typescript
interface AttachmentHandler {
  readonly type: 'REGEX' | 'DICOM' | 'JAVASCRIPT' | 'NONE';
  extract(content: string, context: AttachmentContext): Promise<Result<AttachmentResult>>;
}

interface AttachmentResult {
  readonly modifiedContent: string;          // Content with attachments replaced by references
  readonly attachments: ReadonlyArray<{
    readonly id: string;
    readonly mimeType: string;
    readonly content: Buffer;
  }>;
}
```

Default handler type is `NONE` (no extraction). The `REGEX` handler extracts content matching a pattern (e.g., base64-encoded images in HL7 OBX segments). The `JAVASCRIPT` handler lets users write custom extraction logic. Extracted attachments are stored in `message_attachments` and can be retrieved via the message browser.

---

## Deployment Orchestration

Channel dependencies form a DAG. Deploy in reverse-topological order (dependencies first).

```typescript
class DeploymentOrchestrator {
  async deployChannels(channelIds: ReadonlyArray<ChannelId>): Promise<Result<DeploymentReport>> {
    // Build dependency graph
    const graph = await this.buildDependencyGraph(channelIds);

    // Detect cycles (circular dependencies are invalid)
    if (graph.hasCycle()) {
      return { ok: false, error: new Error('Circular dependency detected') };
    }

    // Get deployment tiers (channels in same tier can deploy in parallel)
    const tiers = graph.getTopologicalTiers();

    // Deploy tier by tier
    for (const tier of tiers) {
      const results = await Promise.allSettled(
        tier.map((channelId) => this.deploySingleChannel(channelId)),
      );
      // Collect errors but continue with remaining tiers
    }
  }

  async undeployChannels(channelIds: ReadonlyArray<ChannelId>): Promise<Result<void>> {
    // Undeploy in REVERSE topological order (dependents first, dependencies last)
    const graph = await this.buildDependencyGraph(channelIds);
    const tiers = graph.getTopologicalTiers().reverse();

    for (const tier of tiers) {
      await Promise.allSettled(
        tier.map((channelId) => this.undeploySingleChannel(channelId)),
      );
    }
  }
}
```

---

## Resolved Decisions

1. **Queue: LISTEN/NOTIFY + polling fallback** — Primary: Postgres `pg_notify('queue:{channelId}:{metaDataId}', messageId)` on enqueue, consumers `LISTEN` and dequeue immediately on notification. Fallback: poll with `SKIP LOCKED` every `queuePollIntervalMs` (default 5000ms) as a safety net to catch missed notifications. Config: `queuePollIntervalMs`, `queueNotifyEnabled` (default true).

2. **Shared worker thread pool for sandbox execution** — A single shared pool (not per-channel). Default size: `os.cpus().length - 1` (leave 1 core for the event loop). Configurable via `sandboxWorkerPoolSize`. Workers are only for CPU-bound `isolated-vm` execution — all I/O is async on the main event loop. Idle channels don't hold workers.

3. **Backpressure via bounded concurrency** — Per-channel concurrency limit using `p-limit`. Source connector dispatch is wrapped in the limiter. When the limit is reached, new messages wait (TCP connections stay open, HTTP requests queue, poll-based sources naturally slow). Config: `maxConcurrentMessages` per channel (default 10).

   **Concurrency model clarification** — Three levels of concurrency control, from outermost to innermost:

   | Control | Scope | What It Limits | Default |
   |---|---|---|---|
   | `processingThreads` (source) | Source connector | How many messages the source can dispatch into the pipeline concurrently | 1 |
   | `maxConcurrentMessages` | Channel (p-limit) | Total in-flight messages across all stages of the pipeline | 10 |
   | `queueThreadCount` (destination) | Per destination | How many queued messages are dequeued and sent concurrently | 1 |
   | `sandboxWorkerPoolSize` | Global | Total worker threads available for sandbox (isolated-vm) execution across all channels | `os.cpus().length - 1` |

   `processingThreads` is the inbound throttle (how fast the source accepts). `maxConcurrentMessages` is the pipeline throttle (overall backpressure). `queueThreadCount` is the outbound throttle (how fast retries drain). The sandbox worker pool is the shared CPU resource — all channels compete for workers. If the pool is exhausted, messages wait for a worker (they don't fail).

4. **Postgres sequences for message IDs** — Per-channel-partition sequences (`bigserial`). Sequential inserts are B-tree friendly, human-readable ("message 10042"), and performant for high-volume append workloads. Composite key `(channel_id, message_id)` is globally unique. For multi-node, each node claims ranges from the shared sequence.

5. **Commit per pipeline stage** — Each stage committed individually for durability. Prevents duplicate side effects on crash recovery (e.g., a destination HTTP request that already succeeded won't be re-sent). This matches Connect's approach and is the correct default for healthcare integration where downstream idempotency is not guaranteed. Channel-level config: `transactionMode: 'PER_STAGE' | 'PER_MESSAGE'` for high-throughput channels where users accept re-processing risk.
