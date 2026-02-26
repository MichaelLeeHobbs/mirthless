# 03 — Connectors Design

> Protocol adapters: interface, plugin architecture, and per-connector specifications.

## Connector Interface

Every connector has two roles: **Receiver** (source) and **Dispatcher** (destination). Two receive patterns: **event-driven** (TCP, HTTP, Channel) and **poll-based** (File, Database, JavaScript).

### Base Interface

```typescript
interface ConnectorRuntime<TProperties> {
  readonly type: ConnectorType;
  readonly properties: Readonly<TProperties>;
  onDeploy(context: DeployContext): Promise<Result<void>>;
  onUndeploy(): Promise<Result<void>>;
  onStart(): Promise<Result<void>>;
  onStop(): Promise<Result<void>>;
  onHalt(): Promise<Result<void>>;  // Force stop — abort in-flight, don't wait
}

interface SourceConnectorRuntime<TProperties = SourceConnectorProperties>
  extends ConnectorRuntime<TProperties> {
  // Event-driven sources call this when messages arrive
  dispatchMessage(raw: RawMessage): Promise<Result<DispatchResult>>;
}

interface PollSourceConnectorRuntime<TProperties = SourceConnectorProperties>
  extends SourceConnectorRuntime<TProperties> {
  poll(signal: AbortSignal): Promise<Result<void>>;
}

interface DestinationConnectorRuntime<TProperties = DestinationConnectorProperties>
  extends ConnectorRuntime<TProperties> {
  send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<Response>>;
}
```

### Deploy Context

```typescript
interface DeployContext {
  readonly channelId: ChannelId;
  readonly connectorId: ConnectorId;
  readonly metaDataId: MetaDataId;
  readonly logger: Logger;             // Scoped to this connector
  readonly eventEmitter: EventEmitter;  // For status events
}
```

### Connector Registry

Compile-time registration (no runtime class loading like Connect):

```typescript
const CONNECTOR_REGISTRY = {
  [CONNECTOR_TYPE.TCP_MLLP]: {
    createSource: (props: TcpListenerProperties) => new TcpMllpReceiver(props),
    createDestination: (props: TcpSenderProperties) => new TcpMllpDispatcher(props),
  },
  [CONNECTOR_TYPE.HTTP]: {
    createSource: (props: HttpListenerProperties) => new HttpReceiver(props),
    createDestination: (props: HttpSenderProperties) => new HttpDispatcher(props),
  },
  // ... etc
} as const;
```

---

## Transmission Mode Pattern (from Connect — keep it)

Separates **transport** (TCP socket) from **framing** (MLLP, raw, delimited):

```typescript
interface TransmissionMode {
  readonly name: string;
  createReader(stream: Readable): AsyncIterable<Buffer>;
  createWriter(stream: Writable): FrameWriter;
}

interface FrameWriter {
  writeFrame(data: Buffer): Promise<void>;
}

// Built-in modes
const MLLP_MODE: TransmissionMode;    // 0x0B ... 0x1C0x0D
const RAW_MODE: TransmissionMode;      // No framing
const DELIMITED_MODE: TransmissionMode; // Custom start/end bytes
```

---

## P0: TCP/MLLP Connector

The bread-and-butter of healthcare integration. HL7v2 over TCP with MLLP framing.

### Source (TCP Listener)

```typescript
class TcpMllpReceiver implements SourceConnectorRuntime<TcpListenerProperties> {
  private server: net.Server | null = null;
  private readonly connections = new Map<string, net.Socket>();

  async onStart(): Promise<Result<void>> {
    this.server = net.createServer({ /* TLS options if configured */ });
    this.server.maxConnections = this.properties.maxConnections;

    this.server.on('connection', (socket) => {
      const id = `${socket.remoteAddress}:${socket.remotePort}`;
      this.connections.set(id, socket);

      const reader = this.transmissionMode.createReader(socket);
      this.handleConnection(id, socket, reader);
    });

    return tryCatch(
      new Promise<void>((resolve, reject) => {
        this.server!.listen(this.properties.port, this.properties.host, resolve);
        this.server!.on('error', reject);
      })
    );
  }

  private async handleConnection(
    id: string,
    socket: net.Socket,
    reader: AsyncIterable<Buffer>,
  ): Promise<void> {
    const writer = this.transmissionMode.createWriter(socket);

    for await (const frame of reader) {
      const content = frame.toString(this.properties.charset);
      const result = await this.dispatchMessage({
        content,
        sourceMap: {
          remoteAddress: socket.remoteAddress,
          remotePort: socket.remotePort,
          localPort: this.properties.port,
        },
      });

      // Send response (ACK/NAK) back on the same connection
      if (result.ok && result.value.response) {
        await writer.writeFrame(Buffer.from(result.value.response, this.properties.charset));
      }
    }

    this.connections.delete(id);
  }

  async onStop(): Promise<Result<void>> {
    this.server?.close();
    for (const socket of this.connections.values()) {
      socket.destroy();
    }
    this.connections.clear();
    return { ok: true, value: undefined };
  }
}
```

### Destination (TCP Sender)

```typescript
class TcpMllpDispatcher implements DestinationConnectorRuntime<TcpSenderProperties> {
  private readonly sockets = new Map<string, net.Socket>();

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<Response>> {
    const socket = await this.getOrCreateSocket(signal);
    if (!socket.ok) return socket;

    const writer = this.transmissionMode.createWriter(socket.value);
    const reader = this.transmissionMode.createReader(socket.value);

    // Send
    await writer.writeFrame(Buffer.from(message.content.encoded!, this.properties.charset));

    // Read response (with timeout)
    if (!this.properties.ignoreResponse) {
      const response = await withTimeout(
        readFirst(reader),
        this.properties.responseTimeout,
        signal,
      );
      return response;
    }

    return { ok: true, value: { status: 'SENT', content: '' } };
  }
}
```

### MLLP Frame Constants

```typescript
const MLLP = {
  START_BYTE: 0x0B,  // VT (Vertical Tab)
  END_BYTE_1: 0x1C,  // FS (File Separator)
  END_BYTE_2: 0x0D,  // CR (Carriage Return)
} as const;
```

---

## P0: Channel (VM) Connector

In-memory inter-channel routing. No network I/O.

```typescript
class ChannelReceiver implements SourceConnectorRuntime<ChannelReaderProperties> {
  // Messages are dispatched directly by ChannelWriter destinations
  // The receiver just needs to be deployed — actual dispatch happens via the engine
}

class ChannelDispatcher implements DestinationConnectorRuntime<ChannelWriterProperties> {
  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<Response>> {
    const targetChannel = this.engine.getChannel(this.properties.targetChannelId);
    if (!targetChannel) return { ok: false, error: new Error('Target channel not found') };

    const result = await targetChannel.dispatchRawMessage({
      content: message.content.encoded!,
      sourceMap: { sourceChannelId: message.channelId },
    });

    return result;
  }
}
```

---

## P1: HTTP Connector

### Source (HTTP Listener)

Uses Express sub-app mounted at the connector's path:

```typescript
class HttpReceiver implements SourceConnectorRuntime<HttpListenerProperties> {
  private server: http.Server | null = null;

  async onStart(): Promise<Result<void>> {
    const app = express();
    app.use(this.properties.contextPath, async (req, res) => {
      const rawMessage: RawMessage = {
        content: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
        sourceMap: {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers)),
          query: req.query,
          remoteAddress: req.ip,
          contextPath: req.path,
          contentType: req.headers['content-type'],
        },
      };

      const result = await this.dispatchMessage(rawMessage);

      res.status(this.properties.responseStatusCode)
        .set(this.properties.responseHeaders)
        .type(this.properties.responseContentType)
        .send(result.ok ? result.value.response : 'Error');
    });

    this.server = app.listen(this.properties.port, this.properties.host);
    return { ok: true, value: undefined };
  }
}
```

### Destination (HTTP Sender)

```typescript
class HttpDispatcher implements DestinationConnectorRuntime<HttpSenderProperties> {
  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<Response>> {
    const url = this.replaceVariables(this.properties.url, message);
    const body = this.replaceVariables(this.properties.body, message);

    const response = await fetch(url, {
      method: this.properties.method,
      headers: Object.fromEntries(this.properties.headers.map(h => [h.name, h.value])),
      body: ['GET', 'HEAD'].includes(this.properties.method) ? undefined : body,
      signal: AbortSignal.timeout(this.properties.timeout),
    });

    return {
      ok: true,
      value: {
        status: response.ok ? 'SENT' : 'ERROR',
        statusCode: response.status,
        content: await response.text(),
        headers: Object.fromEntries(response.headers.entries()),
      },
    };
  }
}
```

---

## P1: File Connector

### Source (File Reader) — Poll-based

```typescript
class FileReceiver implements PollSourceConnectorRuntime<FileReaderProperties> {
  async poll(signal: AbortSignal): Promise<Result<void>> {
    const files = await this.listFiles(this.properties.host, this.properties.fileFilter);

    for (const file of this.sortFiles(files)) {
      if (signal.aborted) break;

      // Check file age (avoid reading files still being written)
      if (this.properties.checkFileAge) {
        const age = Date.now() - file.modifiedAt.getTime();
        if (age < this.properties.fileAge) continue;
      }

      const content = this.properties.binary
        ? (await fs.readFile(file.path)).toString('base64')
        : await fs.readFile(file.path, this.properties.charset);

      await this.dispatchMessage({
        content,
        sourceMap: {
          originalFilename: file.name,
          fileDirectory: file.directory,
          fileSize: file.size,
        },
      });

      // Post-processing: move, delete, or leave
      await this.afterProcessing(file);
    }
    return { ok: true, value: undefined };
  }
}
```

Supported file systems (via adapter pattern):
- Local filesystem (`fs`)
- SFTP (`ssh2-sftp-client`)
- S3 (`@aws-sdk/client-s3`)
- FTP (later)

### Destination (File Writer)

```typescript
class FileDispatcher implements DestinationConnectorRuntime<FileWriterProperties> {
  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<Response>> {
    const filename = this.replaceVariables(this.properties.outputPattern, message);
    const filePath = path.join(this.properties.host, filename);

    const content = this.properties.binary
      ? Buffer.from(message.content.encoded!, 'base64')
      : message.content.encoded!;

    if (this.properties.temporary) {
      const tmpPath = filePath + '.tmp';
      await fs.writeFile(tmpPath, content);
      await fs.rename(tmpPath, filePath);
    } else {
      const flag = this.properties.append ? 'a' : 'w';
      await fs.writeFile(filePath, content, { flag });
    }

    return { ok: true, value: { status: 'SENT', content: filePath } };
  }
}
```

---

## P1: Database Connector

### Source (Database Reader) — Poll-based

```typescript
class DatabaseReceiver implements PollSourceConnectorRuntime<DatabaseReaderProperties> {
  async poll(signal: AbortSignal): Promise<Result<void>> {
    const rows = await this.executeSelect(signal);
    if (!rows.ok) return rows;

    for (const row of rows.value) {
      if (signal.aborted) break;

      // Convert row to XML/JSON based on data type
      const content = this.serializeRow(row);

      await this.dispatchMessage({
        content,
        sourceMap: { resultColumns: Object.keys(row) },
      });

      // Run post-processing update (mark row as processed)
      if (this.properties.updateMode !== 'NEVER') {
        await this.executeUpdate(row);
      }
    }
    return { ok: true, value: undefined };
  }
}
```

### Destination (Database Writer)

```typescript
class DatabaseDispatcher implements DestinationConnectorRuntime<DatabaseWriterProperties> {
  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<Response>> {
    // Replace ${variables} with parameterized placeholders
    const { sql, params } = this.prepareStatement(this.properties.query, message);

    const result = await this.pool.query(sql, params);

    return {
      ok: true,
      value: { status: 'SENT', content: JSON.stringify({ rowsAffected: result.rowCount }) },
    };
  }
}
```

All SQL is parameterized — no string interpolation. Variables from the message context are passed as bind parameters.

---

## P2: JavaScript/TypeScript Connector

### Source (JS/TS Reader) — Poll-based

Runs user code in the sandbox on a schedule. Code template libraries enabled for the channel are injected into the sandbox context, so user scripts can call shared functions from templates.

```typescript
class JavaScriptReceiver implements PollSourceConnectorRuntime<JavaScriptReaderProperties> {
  async poll(signal: AbortSignal): Promise<Result<void>> {
    const result = await this.sandbox.execute(
      this.properties.script,
      { logger: this.logger },
      { timeout: 30_000, signal },
    );

    if (result.ok && result.value) {
      // User script returns message content or array of messages
      const messages = Array.isArray(result.value) ? result.value : [result.value];
      for (const msg of messages) {
        await this.dispatchMessage({ content: String(msg), sourceMap: {} });
      }
    }
    return result.ok ? { ok: true, value: undefined } : result;
  }
}
```

### Destination (JS/TS Writer)

```typescript
class JavaScriptDispatcher implements DestinationConnectorRuntime<JavaScriptWriterProperties> {
  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<Response>> {
    const result = await this.sandbox.execute(
      this.properties.script,
      { msg: message.content.encoded, connectorMessage: message, logger: this.logger },
      { timeout: 30_000, signal },
    );

    return {
      ok: true,
      value: { status: result.ok ? 'SENT' : 'ERROR', content: String(result.ok ? result.value : result.error) },
    };
  }
}
```

---

## Polling Scheduler

Poll-based connectors need a scheduler. Connect uses Quartz (heavy). We use a simple interval-based scheduler with cron support via `node-cron`.

```typescript
const POLLING_TYPE = {
  INTERVAL: 'INTERVAL',
  TIME: 'TIME',
  CRON: 'CRON',
} as const;

interface PollScheduler {
  start(config: PollConfig, callback: () => Promise<void>): void;
  stop(): void;
}

// Implementations:
// - IntervalScheduler: setInterval with configurable ms
// - TimeScheduler: runs at specific time(s) daily
// - CronScheduler: cron expression via node-cron
```

---

## Resolved Decisions

1. **HTTP Listener: isolated Express instances** — Each HTTP source connector gets its own `http.Server` / `https.Server` bound to its configured port. No shared routing. This provides port isolation, TLS isolation (each connector can have its own cert/key), crash isolation, and simplicity. Port consumption is a non-issue — healthcare interfaces typically have a handful of HTTP connectors.

2. **File connector v1 scope: Local + SFTP + S3 + SMB** — Four file system adapters for v1. Local (`fs`) covers local disk plus any OS/Docker-mounted share (NFS, CIFS) — no separate NFS adapter needed since Docker volumes and OS mounts present NFS as a local path. SFTP (`ssh2-sftp-client`) for SSH file transfer. S3 (`@aws-sdk/client-s3`) for cloud storage. SMB (direct client library, no OS mount required) because Windows file shares are extremely common in healthcare (Epic, Cerner, lab systems). FTP and WebDAV deferred to later.

3. **Connection pooling: `generic-pool`** — Use `generic-pool` for TCP dispatcher connection pooling. Mature, well-maintained, handles min/max connections, idle timeout, eviction, and health checks. No reason to build custom.

4. **TLS: per-connector configuration** — Each connector's properties include an optional TLS block (`enabled`, `cert`, `key`, `ca`, `rejectUnauthorized`, `clientCertRequired` for mTLS). No shared TLS profile indirection — if two connectors need the same cert, they both reference the same file path. Keeps configuration explicit and simple.
