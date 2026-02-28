// ===========================================
// E2E Pipeline Smoke Test
// ===========================================
// Tests the full vertical slice: TCP/MLLP receive → pipeline → TCP/MLLP send.
// Uses real TCP connections and in-memory message store.
// Does NOT require a running database.

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import type { Result } from '@mirthless/core-util';
import {
  TcpMllpReceiver,
  TcpMllpDispatcher,
  wrapMllp,
  MllpParser,
} from '@mirthless/connectors';
import {
  VmSandboxExecutor,
  MessageProcessor,
  ChannelRuntime,
  DEFAULT_EXECUTION_OPTIONS,
} from '../index.js';
import type {
  MessageStore,
  PipelineConfig,
  ChannelRuntimeConfig,
} from '../index.js';

// ----- In-Memory Message Store -----

interface StoredMessage {
  readonly channelId: string;
  readonly messageId: number;
  readonly serverId: string;
  processed: boolean;
}

interface StoredConnectorMessage {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly connectorName: string;
  status: string;
}

interface StoredContent {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly contentType: number;
  readonly content: string;
  readonly dataType: string;
}

interface StoredStat {
  readonly channelId: string;
  readonly metaDataId: number;
  readonly serverId: string;
  received: number;
  filtered: number;
  sent: number;
  errored: number;
}

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

function createInMemoryStore(): MessageStore & {
  messages: StoredMessage[];
  connectorMessages: StoredConnectorMessage[];
  contents: StoredContent[];
  stats: StoredStat[];
} {
  let nextMessageId = 1;
  const messages: StoredMessage[] = [];
  const connectorMessages: StoredConnectorMessage[] = [];
  const contents: StoredContent[] = [];
  const stats: StoredStat[] = [];

  return {
    messages,
    connectorMessages,
    contents,
    stats,

    createMessage: async (channelId, serverId) => {
      const messageId = nextMessageId++;
      messages.push({ channelId, messageId, serverId, processed: false });
      return ok({ messageId });
    },
    createConnectorMessage: async (channelId, messageId, metaDataId, connectorName, status) => {
      connectorMessages.push({ channelId, messageId, metaDataId, connectorName, status });
      return ok(undefined);
    },
    updateConnectorMessageStatus: async (channelId, messageId, metaDataId, status) => {
      const cm = connectorMessages.find(
        (m) => m.channelId === channelId && m.messageId === messageId && m.metaDataId === metaDataId,
      );
      if (cm) (cm as { status: string }).status = status;
      return ok(undefined);
    },
    storeContent: async (channelId, messageId, metaDataId, contentType, content, dataType) => {
      contents.push({ channelId, messageId, metaDataId, contentType, content, dataType });
      return ok(undefined);
    },
    markProcessed: async (channelId, messageId) => {
      const msg = messages.find((m) => m.channelId === channelId && m.messageId === messageId);
      if (msg) (msg as { processed: boolean }).processed = true;
      return ok(undefined);
    },
    enqueue: async () => ok(undefined),
    loadContent: async (channelId, messageId, metaDataId, contentType) => {
      const entry = contents.find(
        (c) => c.channelId === channelId && c.messageId === messageId
          && c.metaDataId === metaDataId && c.contentType === contentType,
      );
      return ok(entry?.content ?? null);
    },
    incrementStats: async (channelId, metaDataId, serverId, field) => {
      let stat = stats.find(
        (s) => s.channelId === channelId && s.metaDataId === metaDataId && s.serverId === serverId,
      );
      if (!stat) {
        stat = { channelId, metaDataId, serverId, received: 0, filtered: 0, sent: 0, errored: 0 };
        stats.push(stat);
      }
      (stat as Record<string, number>)[field]++;
      return ok(undefined);
    },
    dequeue: async () => ok([]),
    release: async () => ok(undefined),
  };
}

// ----- Test Constants -----

const SOURCE_PORT = 17661;
const DEST_PORT = 17662;
const CHANNEL_ID = '00000000-0000-0000-0000-e2e000000001';
const SERVER_ID = 'e2e-server';

const HL7_ADT = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|12345|P|2.5',
  'EVN|A01|20260228120000',
  'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
  'PV1||I|ICU^101^A',
].join('\r');

// ----- Tests -----

let receiver: TcpMllpReceiver | null = null;
let destServer: net.Server | null = null;
let runtime: ChannelRuntime | null = null;

afterEach(async () => {
  if (runtime) {
    const state = runtime.getState();
    if (state === 'STARTED' || state === 'PAUSED') {
      await runtime.stop();
    }
    if (runtime.getState() === 'STOPPED') {
      await runtime.undeploy();
    }
    runtime = null;
  }
  if (destServer) {
    destServer.close();
    destServer = null;
  }
  receiver = null;
});

describe('E2E Pipeline', () => {
  it('receives HL7 via MLLP, routes through pipeline, sends to destination', async () => {
    // ---- 1. Set up mock destination server ----
    const receivedAtDest: string[] = [];

    destServer = net.createServer((socket) => {
      const parser = new MllpParser();
      socket.on('data', (chunk: Buffer) => {
        const msgs = parser.parse(chunk);
        for (const msg of msgs) {
          receivedAtDest.push(msg);
          // Send ACK
          const ack = `MSH|^~\\&|RECEIVER|FACILITY|SENDER|FACILITY|20260228120001||ACK^A01|99999|P|2.5\rMSA|AA|12345`;
          socket.write(wrapMllp(ack));
        }
      });
    });

    await new Promise<void>((resolve) => {
      destServer!.listen(DEST_PORT, '127.0.0.1', resolve);
    });

    // ---- 2. Set up engine components ----
    const sandbox = new VmSandboxExecutor();
    const store = createInMemoryStore();

    // Source connector
    receiver = new TcpMllpReceiver({
      host: '127.0.0.1',
      port: SOURCE_PORT,
      maxConnections: 10,
    });

    // Destination connector
    const dispatcher = new TcpMllpDispatcher({
      host: '127.0.0.1',
      port: DEST_PORT,
      maxConnections: 5,
      responseTimeout: 5_000,
    });

    // Pipeline config — passthrough (no filters, no transformers)
    const pipelineConfig: PipelineConfig = {
      channelId: CHANNEL_ID,
      serverId: SERVER_ID,
      dataType: 'HL7V2',
      scripts: {},
      destinations: [{
        metaDataId: 1,
        name: 'Lab Destination',
        enabled: true,
        scripts: {},
        queueEnabled: false,
      }],
    };

    const processor = new MessageProcessor(
      sandbox, store,
      async (_metaDataId, content, signal) => {
        return dispatcher.send({
          channelId: CHANNEL_ID,
          messageId: 0,
          metaDataId: 1,
          content,
          dataType: 'HL7V2',
        }, signal);
      },
      pipelineConfig,
      DEFAULT_EXECUTION_OPTIONS,
    );

    // ---- 3. Set up runtime ----
    runtime = new ChannelRuntime();

    const destinations = new Map<number, TcpMllpDispatcher>();
    destinations.set(1, dispatcher);

    const runtimeConfig: ChannelRuntimeConfig = {
      channelId: CHANNEL_ID,
      source: receiver,
      destinations,
      onMessage: async (raw) => processor.processMessage(
        { rawContent: raw.content, sourceMap: raw.sourceMap },
        AbortSignal.timeout(10_000),
      ),
    };

    // ---- 4. Deploy and start ----
    const deployResult = await runtime.deploy(runtimeConfig);
    expect(deployResult.ok).toBe(true);

    const startResult = await runtime.start();
    expect(startResult.ok).toBe(true);

    // ---- 5. Send HL7 message via TCP/MLLP ----
    const response = await new Promise<string>((resolve, reject) => {
      const client = net.createConnection({ host: '127.0.0.1', port: SOURCE_PORT }, () => {
        client.write(wrapMllp(HL7_ADT));
      });

      const parser = new MllpParser();
      client.on('data', (chunk: Buffer) => {
        const msgs = parser.parse(chunk);
        if (msgs.length > 0) {
          client.end();
          resolve(msgs[0]!);
        }
      });

      client.on('error', reject);
      setTimeout(() => {
        client.destroy();
        reject(new Error('Timeout waiting for response'));
      }, 10_000);
    });

    // ---- 6. Verify results ----

    // Destination received the message
    expect(receivedAtDest).toHaveLength(1);
    expect(receivedAtDest[0]).toContain('ADT^A01');
    expect(receivedAtDest[0]).toContain('DOE^JOHN');

    // Source got an ACK response back
    expect(response).toContain('MSA|AA|12345');

    // Message was stored
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.channelId).toBe(CHANNEL_ID);
    expect(store.messages[0]!.processed).toBe(true);

    // Connector messages created for source (0) and destination (1)
    const sourceConnMsg = store.connectorMessages.find((cm) => cm.metaDataId === 0);
    const destConnMsg = store.connectorMessages.find((cm) => cm.metaDataId === 1);
    expect(sourceConnMsg).toBeDefined();
    expect(destConnMsg).toBeDefined();
    expect(sourceConnMsg!.status).toBe('SENT');
    expect(destConnMsg!.status).toBe('SENT');

    // RAW content stored
    const rawContent = store.contents.find((c) => c.contentType === 1);
    expect(rawContent).toBeDefined();
    expect(rawContent!.content).toContain('ADT^A01');

    // Statistics incremented
    const sourceStat = store.stats.find((s) => s.metaDataId === 0);
    const destStat = store.stats.find((s) => s.metaDataId === 1);
    expect(sourceStat).toBeDefined();
    expect(sourceStat!.received).toBe(1);
    expect(sourceStat!.sent).toBe(1);
    expect(destStat).toBeDefined();
    expect(destStat!.sent).toBe(1);

    // ---- 7. Stop + cleanup ----
    await runtime.stop();
    await runtime.undeploy();
    runtime = null;

    sandbox.dispose();
  }, 15_000);
});
