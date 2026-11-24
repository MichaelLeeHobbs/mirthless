import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import {
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
  PipelineConfig,
  ChannelRuntimeConfig,
} from '@galvanigraph/engine';
import { createInMemoryStore, toDispatchResult } from './support/e2e-harness.js';
import { mllpSource, mllpDestination, sendMllp } from './support/tcp-helpers.js';
import { freePort } from '../../__fixtures__/free-port.js';

const SOURCE_PORT = await freePort();
const DEST_PORT = await freePort();
const CHANNEL_ID = '00000000-0000-0000-0000-e2e000000001';
const SERVER_ID = 'e2e-server';

const HL7_ADT = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|12345|P|2.5',
  'EVN|A01|20260228120000',
  'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
  'PV1||I|ICU^101^A',
].join('\r');

let receiver: SourceConnectorRuntime | null = null;
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
    const receivedAtDest: string[] = [];

    destServer = net.createServer((socket) => {
      const parser = new MllpParser();
      socket.on('data', (chunk: Buffer) => {
        const msgs = parser.parse(chunk);
        for (const msg of msgs) {
          receivedAtDest.push(msg);
          const ack = `MSH|^~\\&|RECEIVER|FACILITY|SENDER|FACILITY|20260228120001||ACK^A01|99999|P|2.5\rMSA|AA|12345`;
          socket.write(wrapMllp(ack));
        }
      });
    });

    await new Promise<void>((resolve) => {
      destServer!.listen(DEST_PORT, '127.0.0.1', resolve);
    });

    const sandbox = new VmSandboxExecutor();
    const store = createInMemoryStore();

    receiver = mllpSource(SOURCE_PORT, { maxConnections: 10 });

    const dispatcher = mllpDestination(DEST_PORT, { maxConnections: 5, responseTimeout: 5_000 });

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
        queueMode: 'NEVER',
      }],
    };

    const processor = new MessageProcessor(
      sandbox, store,
      async (_metaDataId, messageId, content, signal) => {
        return dispatcher.send({
          channelId: CHANNEL_ID,
          messageId,
          metaDataId: 1,
          content,
          dataType: 'HL7V2',
        }, signal);
      },
      pipelineConfig,
      DEFAULT_EXECUTION_OPTIONS,
    );

    runtime = new ChannelRuntime();

    const destinations = new Map<number, DestinationConnectorRuntime>();
    destinations.set(1, dispatcher);

    const runtimeConfig: ChannelRuntimeConfig = {
      channelId: CHANNEL_ID,
      source: receiver,
      destinations,
      onMessage: async (raw) => toDispatchResult(await processor.processMessage(
        { rawContent: raw.content, sourceMap: raw.sourceMap },
        AbortSignal.timeout(10_000),
      )),
    };

    const deployResult = await runtime.deploy(runtimeConfig);
    expect(deployResult.ok).toBe(true);

    const startResult = await runtime.start();
    expect(startResult.ok).toBe(true);

    const response = await sendMllp(SOURCE_PORT, HL7_ADT);

    expect(receivedAtDest).toHaveLength(1);
    expect(receivedAtDest[0]).toContain('ADT^A01');
    expect(receivedAtDest[0]).toContain('DOE^JOHN');

    expect(response).toContain('MSA|AA|12345');

    expect(store.messages).toHaveLength(1);
    expect(store.messages[0]!.channelId).toBe(CHANNEL_ID);
    expect(store.messages[0]!.processed).toBe(true);

    const sourceConnMsg = store.connectorMessages.find((cm) => cm.metaDataId === 0);
    const destConnMsg = store.connectorMessages.find((cm) => cm.metaDataId === 1);
    expect(sourceConnMsg).toBeDefined();
    expect(destConnMsg).toBeDefined();
    expect(sourceConnMsg!.status).toBe('SENT');
    expect(destConnMsg!.status).toBe('SENT');

    const rawContent = store.contents.find((c) => c.contentType === 1);
    expect(rawContent).toBeDefined();
    expect(rawContent!.content).toContain('ADT^A01');

    const sourceStat = store.stats.find((s) => s.metaDataId === 0);
    const destStat = store.stats.find((s) => s.metaDataId === 1);
    expect(sourceStat).toBeDefined();
    expect(sourceStat!.received).toBe(1);
    expect(sourceStat!.sent).toBe(1);
    expect(destStat).toBeDefined();
    expect(destStat!.sent).toBe(1);

    await runtime.stop();
    await runtime.undeploy();
    runtime = null;

    sandbox.dispose();
  }, 15_000);
});
