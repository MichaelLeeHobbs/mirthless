// ===========================================
// E2E Destination Scripts Test
// ===========================================
// Proves destination-level Filter + Transformer + Response-Transformer run
// across a REAL send boundary: HL7 arrives over TCP/MLLP, routes through the
// ChannelRuntime → MessageProcessor, and is dispatched to a real TCP/MLLP
// destination server that returns a real ACK (so the response transformer has
// genuine input to transform).
//
// Assertions target the stored connector content types defined in
// @mirthless/core-models CONTENT_TYPE:
//   - CT_SENT (5)                 — outbound content AFTER the dest transformer
//   - CT_RESPONSE (6)             — raw response from the destination
//   - CT_RESPONSE_TRANSFORMED (7) — response AFTER the response transformer
//
// Does NOT require a running database (in-memory message store).

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import type { Result } from '@mirthless/core-util';
import { CONTENT_TYPE } from '@mirthless/core-models';
import {
  TcpMllpReceiver,
  TcpMllpDispatcher,
  MLLP_RESPONSE_MODE,
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
  CompiledScript,
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

function makeScript(code: string): CompiledScript {
  return { code };
}

type InMemoryStore = MessageStore & {
  messages: StoredMessage[];
  connectorMessages: StoredConnectorMessage[];
  contents: StoredContent[];
  stats: StoredStat[];
};

function createInMemoryStore(): InMemoryStore {
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
      return ok({ messageId, correlationId: `corr-${String(messageId)}` });
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

const SOURCE_PORT = 17681;
const DEST_PORT = 17682;
const CHANNEL_ID = '00000000-0000-0000-0000-e2e000000042';
const SERVER_ID = 'e2e-dest-scripts-server';
const DEST_META_ID = 1;

// A message that the destination filter should REJECT (contains BLOCKME).
const HL7_BLOCKED = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|BLOCKME01|P|2.5',
  'PID|||99999^^^MRN||BLOCKME^PATIENT||19700101|F',
].join('\r');

// A message that PASSES the filter; the transformer rewrites DOE^JOHN.
const HL7_ACCEPTED = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|OK00001|P|2.5',
  'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
].join('\r');

// ----- Destination scripts under test -----

// Reject anything carrying the BLOCKME marker; accept everything else.
// String(msg) keeps these dataType-agnostic (msg is an HL7 proxy under HL7V2).
const DEST_FILTER = makeScript("return String(msg).indexOf('BLOCKME') === -1;");
// Rewrite the patient name on the outbound (SENT) content.
const DEST_TRANSFORMER = makeScript("return String(msg).split('DOE^JOHN').join('SMITH^JANE');");
// Prefix the destination's response so we can prove it was transformed.
const DEST_RESPONSE_TRANSFORMER = makeScript("return 'RT_PREFIX|' + String(msg);");

// ----- Harness lifecycle -----

let receiver: TcpMllpReceiver | null = null;
let destServer: net.Server | null = null;
let runtime: ChannelRuntime | null = null;
let sandbox: VmSandboxExecutor | null = null;

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
  if (sandbox) {
    sandbox.dispose();
    sandbox = null;
  }
  receiver = null;
});

/** Send one HL7 message over MLLP to the source and resolve with the framed response. */
async function sendMllp(port: number, message: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port }, () => {
      client.write(wrapMllp(message));
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
      reject(new Error('Timeout waiting for MLLP response'));
    }, 10_000);
  });
}

// ----- Test -----

describe('E2E Destination Scripts (filter + transformer + responseTransformer)', () => {
  it('filters, transforms, and response-transforms across a real send boundary', async () => {
    // ---- 1. Real destination server that returns a real ACK ----
    const receivedAtDest: string[] = [];
    destServer = net.createServer((socket) => {
      const parser = new MllpParser();
      socket.on('data', (chunk: Buffer) => {
        for (const msg of parser.parse(chunk)) {
          receivedAtDest.push(msg);
          const ack = 'MSH|^~\\&|RECEIVER|FACILITY|SENDER|FACILITY|20260228120001||ACK^A01|A1|P|2.5\rMSA|AA|OK00001';
          socket.write(wrapMllp(ack));
        }
      });
    });
    await new Promise<void>((resolve) => {
      destServer!.listen(DEST_PORT, '127.0.0.1', resolve);
    });

    // ---- 2. Engine components ----
    sandbox = new VmSandboxExecutor();
    const store = createInMemoryStore();

    receiver = new TcpMllpReceiver({
      host: '127.0.0.1',
      port: SOURCE_PORT,
      maxConnections: 10,
      // PASSTHROUGH so the (response-transformed) pipeline response reaches the source client.
      responseMode: MLLP_RESPONSE_MODE.PASSTHROUGH,
    } as never);

    const dispatcher = new TcpMllpDispatcher({
      host: '127.0.0.1',
      port: DEST_PORT,
      maxConnections: 5,
      responseTimeout: 5_000,
    });

    // Destination carries all three scripts under test.
    const pipelineConfig: PipelineConfig = {
      channelId: CHANNEL_ID,
      serverId: SERVER_ID,
      dataType: 'HL7V2',
      scripts: {},
      destinations: [{
        metaDataId: DEST_META_ID,
        name: 'Scripted Destination',
        enabled: true,
        scripts: {
          filter: DEST_FILTER,
          transformer: DEST_TRANSFORMER,
          responseTransformer: DEST_RESPONSE_TRANSFORMER,
        },
        queueMode: 'NEVER',
      }],
    };

    const processor = new MessageProcessor(
      sandbox, store,
      async (_metaDataId, messageId, content, signal) => dispatcher.send({
        channelId: CHANNEL_ID,
        messageId,
        metaDataId: DEST_META_ID,
        content,
        dataType: 'HL7V2',
      }, signal),
      pipelineConfig,
      DEFAULT_EXECUTION_OPTIONS,
    );

    // ---- 3. Runtime ----
    runtime = new ChannelRuntime();
    const destinations = new Map<number, TcpMllpDispatcher>();
    destinations.set(DEST_META_ID, dispatcher);

    const runtimeConfig: ChannelRuntimeConfig = {
      channelId: CHANNEL_ID,
      source: receiver,
      destinations,
      onMessage: async (raw) => processor.processMessage(
        { rawContent: raw.content, sourceMap: raw.sourceMap },
        AbortSignal.timeout(10_000),
      ),
    };

    expect((await runtime.deploy(runtimeConfig)).ok).toBe(true);
    expect((await runtime.start()).ok).toBe(true);

    // ---- 4. Send the BLOCKED message (messageId 1), then the ACCEPTED one (messageId 2) ----
    await sendMllp(SOURCE_PORT, HL7_BLOCKED);
    const acceptedResponse = await sendMllp(SOURCE_PORT, HL7_ACCEPTED);

    const BLOCKED_ID = 1;
    const ACCEPTED_ID = 2;

    // ===== Assertion group A: rejected message is NOT sent =====
    // Only the accepted message reaches the destination server.
    expect(receivedAtDest).toHaveLength(1);
    expect(receivedAtDest[0]).not.toContain('BLOCKME');

    const blockedDestCm = store.connectorMessages.find(
      (cm) => cm.messageId === BLOCKED_ID && cm.metaDataId === DEST_META_ID,
    );
    expect(blockedDestCm).toBeDefined();
    expect(blockedDestCm!.status).toBe('FILTERED');

    // A rejected destination stores neither SENT nor any response content.
    const blockedSent = store.contents.filter(
      (c) => c.messageId === BLOCKED_ID && c.metaDataId === DEST_META_ID && c.contentType === CONTENT_TYPE.SENT,
    );
    const blockedResponses = store.contents.filter(
      (c) => c.messageId === BLOCKED_ID && c.metaDataId === DEST_META_ID
        && (c.contentType === CONTENT_TYPE.RESPONSE || c.contentType === CONTENT_TYPE.RESPONSE_TRANSFORMED),
    );
    expect(blockedSent).toHaveLength(0);
    expect(blockedResponses).toHaveLength(0);

    // ===== Assertion group B: accepted message is transformed by the dest transformer =====
    // The wire content that hit the destination reflects the transformer output.
    expect(receivedAtDest[0]).toContain('SMITH^JANE');
    expect(receivedAtDest[0]).not.toContain('DOE^JOHN');

    const sentContent = store.contents.find(
      (c) => c.messageId === ACCEPTED_ID && c.metaDataId === DEST_META_ID && c.contentType === CONTENT_TYPE.SENT,
    );
    expect(sentContent).toBeDefined();
    expect(sentContent!.content).toContain('SMITH^JANE');
    expect(sentContent!.content).not.toContain('DOE^JOHN');

    // ===== Assertion group C: the response is transformed by the responseTransformer =====
    // Raw response (CT_RESPONSE) stored verbatim from the destination ACK.
    const rawResponse = store.contents.find(
      (c) => c.messageId === ACCEPTED_ID && c.metaDataId === DEST_META_ID && c.contentType === CONTENT_TYPE.RESPONSE,
    );
    expect(rawResponse).toBeDefined();
    expect(rawResponse!.content).toContain('MSA|AA|OK00001');
    expect(rawResponse!.content).not.toContain('RT_PREFIX|');

    // Transformed response (CT_RESPONSE_TRANSFORMED) carries the responseTransformer prefix.
    const transformedResponse = store.contents.find(
      (c) => c.messageId === ACCEPTED_ID && c.metaDataId === DEST_META_ID
        && c.contentType === CONTENT_TYPE.RESPONSE_TRANSFORMED,
    );
    expect(transformedResponse).toBeDefined();
    expect(transformedResponse!.content.startsWith('RT_PREFIX|')).toBe(true);
    expect(transformedResponse!.content).toContain('MSA|AA|OK00001');

    // The transformed response is what flows back to the source over the wire.
    expect(acceptedResponse).toContain('RT_PREFIX|');

    // Destination connector for the accepted message is SENT.
    const acceptedDestCm = store.connectorMessages.find(
      (cm) => cm.messageId === ACCEPTED_ID && cm.metaDataId === DEST_META_ID,
    );
    expect(acceptedDestCm).toBeDefined();
    expect(acceptedDestCm!.status).toBe('SENT');

    // ---- 5. Cleanup ----
    await runtime.stop();
    await runtime.undeploy();
    runtime = null;
  }, 20_000);
});
