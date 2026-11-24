// A real MLLP destination server returns a real ACK, so the response transformer has genuine input.

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import {
  MLLP_RESPONSE_MODE,
  wrapMllp,
  MllpParser,
  type SourceConnectorRuntime,
  type DestinationConnectorRuntime,
} from '../../index.js';
import {
  VmSandboxExecutor,
  MessageProcessor,
  ChannelRuntime,
  DEFAULT_EXECUTION_OPTIONS,
} from '@galvanigraph/engine';
import type {
  CompiledScript,
  PipelineConfig,
  ChannelRuntimeConfig,
} from '@galvanigraph/engine';
import { createInMemoryStore, toDispatchResult } from './support/e2e-harness.js';
import { mllpSource, mllpDestination, sendMllp } from './support/tcp-helpers.js';
import { freePort } from '../../__fixtures__/free-port.js';

function makeScript(code: string): CompiledScript {
  return { code };
}

// Unique across e2e files: vitest runs them in parallel.
const SOURCE_PORT = await freePort();
const DEST_PORT = await freePort();
const CHANNEL_ID = '00000000-0000-0000-0000-e2e000000042';
const SERVER_ID = 'e2e-dest-scripts-server';
const DEST_META_ID = 1;

const HL7_BLOCKED = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|BLOCKME01|P|2.5',
  'PID|||99999^^^MRN||BLOCKME^PATIENT||19700101|F',
].join('\r');

const HL7_ACCEPTED = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|OK00001|P|2.5',
  'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
].join('\r');

// String(msg): under HL7V2, msg is an HL7 proxy, not a string.
const DEST_FILTER = makeScript("return String(msg).indexOf('BLOCKME') === -1;");
const DEST_TRANSFORMER = makeScript("return String(msg).split('DOE^JOHN').join('SMITH^JANE');");
const DEST_RESPONSE_TRANSFORMER = makeScript("return 'RT_PREFIX|' + String(msg);");

let receiver: SourceConnectorRuntime | null = null;
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

describe('E2E Destination Scripts (filter + transformer + responseTransformer)', () => {
  it('filters, transforms, and response-transforms across a real send boundary', async () => {
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

    sandbox = new VmSandboxExecutor();
    const store = createInMemoryStore();

    receiver = mllpSource(SOURCE_PORT, {
      maxConnections: 10,
      // PASSTHROUGH so the (response-transformed) pipeline response reaches the source client.
      responseMode: MLLP_RESPONSE_MODE.PASSTHROUGH,
    });

    const dispatcher = mllpDestination(DEST_PORT, { maxConnections: 5, responseTimeout: 5_000 });

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

    runtime = new ChannelRuntime();
    const destinations = new Map<number, DestinationConnectorRuntime>();
    destinations.set(DEST_META_ID, dispatcher);

    const runtimeConfig: ChannelRuntimeConfig = {
      channelId: CHANNEL_ID,
      source: receiver,
      destinations,
      onMessage: async (raw) => toDispatchResult(await processor.processMessage(
        { rawContent: raw.content, sourceMap: raw.sourceMap },
        AbortSignal.timeout(10_000),
      )),
    };

    expect((await runtime.deploy(runtimeConfig)).ok).toBe(true);
    expect((await runtime.start()).ok).toBe(true);

    // Message ids follow send order.
    await sendMllp(SOURCE_PORT, HL7_BLOCKED);
    const acceptedResponse = await sendMllp(SOURCE_PORT, HL7_ACCEPTED);

    const BLOCKED_ID = 1;
    const ACCEPTED_ID = 2;

    expect(receivedAtDest).toHaveLength(1);
    expect(receivedAtDest[0]).not.toContain('BLOCKME');

    const blockedDestCm = store.connectorMessages.find(
      (cm) => cm.messageId === BLOCKED_ID && cm.metaDataId === DEST_META_ID,
    );
    expect(blockedDestCm).toBeDefined();
    expect(blockedDestCm!.status).toBe('FILTERED');

    const blockedSent = store.contents.filter(
      (c) => c.messageId === BLOCKED_ID && c.metaDataId === DEST_META_ID && c.contentType === CONTENT_TYPE.SENT,
    );
    const blockedResponses = store.contents.filter(
      (c) => c.messageId === BLOCKED_ID && c.metaDataId === DEST_META_ID
        && (c.contentType === CONTENT_TYPE.RESPONSE || c.contentType === CONTENT_TYPE.RESPONSE_TRANSFORMED),
    );
    expect(blockedSent).toHaveLength(0);
    expect(blockedResponses).toHaveLength(0);

    expect(receivedAtDest[0]).toContain('SMITH^JANE');
    expect(receivedAtDest[0]).not.toContain('DOE^JOHN');

    const sentContent = store.contents.find(
      (c) => c.messageId === ACCEPTED_ID && c.metaDataId === DEST_META_ID && c.contentType === CONTENT_TYPE.SENT,
    );
    expect(sentContent).toBeDefined();
    expect(sentContent!.content).toContain('SMITH^JANE');
    expect(sentContent!.content).not.toContain('DOE^JOHN');

    const rawResponse = store.contents.find(
      (c) => c.messageId === ACCEPTED_ID && c.metaDataId === DEST_META_ID && c.contentType === CONTENT_TYPE.RESPONSE,
    );
    expect(rawResponse).toBeDefined();
    expect(rawResponse!.content).toContain('MSA|AA|OK00001');
    expect(rawResponse!.content).not.toContain('RT_PREFIX|');

    const transformedResponse = store.contents.find(
      (c) => c.messageId === ACCEPTED_ID && c.metaDataId === DEST_META_ID
        && c.contentType === CONTENT_TYPE.RESPONSE_TRANSFORMED,
    );
    expect(transformedResponse).toBeDefined();
    expect(transformedResponse!.content.startsWith('RT_PREFIX|')).toBe(true);
    expect(transformedResponse!.content).toContain('MSA|AA|OK00001');

    expect(acceptedResponse).toContain('RT_PREFIX|');

    const acceptedDestCm = store.connectorMessages.find(
      (cm) => cm.messageId === ACCEPTED_ID && cm.metaDataId === DEST_META_ID,
    );
    expect(acceptedDestCm).toBeDefined();
    expect(acceptedDestCm!.status).toBe('SENT');

    await runtime.stop();
    await runtime.undeploy();
    runtime = null;
  }, 20_000);
});
