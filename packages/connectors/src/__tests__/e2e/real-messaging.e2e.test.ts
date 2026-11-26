import * as net from 'node:net';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import {
  ChannelReceiver,
  ChannelDispatcher,
  MllpParser,
  wrapMllp,
  clearChannelRegistry,
} from '../../index.js';
import type { CodeTemplateData } from '@galvanigraph/engine';
import {
  deployChannel,
  teardownAll,
  CaptureDestination,
  type DeployedChannel,
} from './support/e2e-harness.js';
import { mllpSource, mllpDestination, startMllpCaptureServer, sendMllp, type MllpCaptureServer } from './support/tcp-helpers.js';
import { freePort } from '../../__fixtures__/free-port.js';

const HL7_ADT = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|12345|P|2.5',
  'EVN|A01|20260228120000',
  'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
  'PV1||I|ICU^101^A',
].join('\r');

const REDACT_TEMPLATE: CodeTemplateData = {
  type: 'FUNCTION',
  contexts: ['SOURCE_FILTER_TRANSFORMER'],
  code: [
    '/** Redact the MRN in a raw HL7 v2 message. */',
    'function redactMrn(hl7: string): string {',
    "  return hl7.split('12345^^^MRN').join('REDACTED^^^MRN');",
    '}',
  ].join('\n'),
};

const SRC_PORT_1 = await freePort();
const SRC_PORT_2 = await freePort();
const SRC_PORT_3 = await freePort();

// Delivery runs compiled scripts and crosses real sockets, which takes seconds on a
// loaded machine (#213). The wait stays inside the 30 s test budget so a miss names it.
const DELIVERY_WAIT = { timeout: 20_000, interval: 10 } as const;

let deployed: DeployedChannel[] = [];
let captureServer: MllpCaptureServer | null = null;

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  if (captureServer) { captureServer.close(); captureServer = null; }
  clearChannelRegistry();
});

describe('real message through a single channel (TCP → transform → TCP)', () => {
  it('applies a TS transformer using a code template and delivers to a real TCP destination', async () => {
    captureServer = await startMllpCaptureServer();

    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-realmsg00001',
      dataType: 'HL7V2',
      source: mllpSource(SRC_PORT_1, { maxConnections: 10 }),
      templates: [REDACT_TEMPLATE],
      transformer: [
        'const out: string = redactMrn(String(msg));',
        "return out + '\\rZZZ|processed';",
      ].join('\n'),
      destinations: [{
        metaDataId: 1,
        name: 'TCP Out',
        connector: mllpDestination(captureServer.port, { maxConnections: 5, responseTimeout: 5_000 }),
      }],
    });
    deployed.push(channel);

    const ack = await sendMllp(SRC_PORT_1, HL7_ADT);
    expect(ack).toContain('MSH');

    await vi.waitFor(() => { expect(captureServer?.received).toHaveLength(1); }, DELIVERY_WAIT);
    const delivered = captureServer.received[0] ?? '';
    expect(delivered).toContain('REDACTED^^^MRN');
    expect(delivered).toContain('ZZZ|processed');
    expect(delivered).not.toContain('12345^^^MRN');

    expect(channel.store.messageCount()).toBe(1);
    const raw = channel.store.contentOf(1, 0, CONTENT_TYPE.RAW);
    expect(raw).toContain('12345^^^MRN');
    const sent = channel.store.contentOf(1, 1, CONTENT_TYPE.SENT);
    expect(sent).toContain('ZZZ|processed');
    expect(sent).toContain('REDACTED^^^MRN');
  });
});

describe('an MLLP source that passes a destination\'s answer through (#414)', () => {
  const ackFrom = (code: string) => (message: string): string =>
    `MSH|^~\\&|LAB|B|A|C|20260101||ACK|L${code}|P|2.5\rMSA|${code}|${message.split('\r')[0]?.split('|')[9] ?? ''}`;
  let refusing: MllpCaptureServer | null = null;
  afterEach(() => { refusing?.close(); refusing = null; });

  it.each([
    ['answers the sender with AE when another destination refused it', 'AE', 'MSA|AE|12345'],
    ['passes the answer through when every destination took it', 'AA', 'MSA|AA|12345'],
  ] as const)('%s', async (_what, second, expected) => {
    captureServer = await startMllpCaptureServer(ackFrom('AA'));
    refusing = await startMllpCaptureServer(ackFrom(second));
    const port = await freePort();
    const channel = await deployChannel({
      channelId: `00000000-0000-0000-0000-passthru000${second === 'AE' ? '1' : '2'}`,
      dataType: 'HL7V2',
      source: mllpSource(port, { responseMode: 'PASSTHROUGH' }),
      responseFrom: 'Lab',
      destinations: [
        { metaDataId: 1, name: 'Lab', connector: mllpDestination(captureServer.port, { responseTimeout: 5_000 }) },
        { metaDataId: 2, name: 'Billing', connector: mllpDestination(refusing.port, { responseTimeout: 5_000 }) },
      ],
    });
    deployed.push(channel);

    const answer = await sendMllp(port, HL7_ADT);

    expect(answer).toContain(expected);
    expect(answer.includes('|LAA|')).toBe(second === 'AA');
    // Built by the source, not the refusing partner's own answer.
    expect(answer).not.toContain('|LAE|');
    expect(captureServer.received).toHaveLength(1);
  });
});

describe('an MLLP destination whose partner answers without an MSA segment (#414)', () => {
  it('reads ERROR, and the source answers AE', async () => {
    captureServer = await startMllpCaptureServer(() => 'MSAX|AA|12345');
    const port = await freePort();
    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-msaxnotmsa01',
      dataType: 'HL7V2',
      source: mllpSource(port),
      destinations: [{ metaDataId: 1, name: 'Lab', connector: mllpDestination(captureServer.port, { responseTimeout: 5_000 }) }],
    });
    deployed.push(channel);

    expect(await sendMllp(port, HL7_ADT)).toContain('MSA|AE|12345');
    expect(channel.store.connectorMessages.find((m) => m.metaDataId === 1)?.status).toBe('ERROR');
    expect(channel.store.contentOf(1, 1, CONTENT_TYPE.ERROR)).toContain('Unparseable acknowledgement');
  });
});

describe('a channel stopped while a message is on its way', () => {
  it('delivers it and answers its sender, and leaves the one behind it unanswered and unrecorded (#413)', async () => {
    let sending = (): void => undefined;
    const reached = new Promise<void>((resolve) => { sending = resolve; });
    let letGo = (): void => undefined;
    const held = new Promise<void>((resolve) => { letGo = resolve; });
    const sink = new CaptureDestination();
    const send = sink.send.bind(sink);
    vi.spyOn(sink, 'send').mockImplementation(async (message, signal) => {
      sending();
      await held;
      return send(message, signal);
    });
    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-realmsg00004',
      dataType: 'HL7V2',
      source: mllpSource(SRC_PORT_3),
      destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
    });
    deployed.push(channel);

    const answers: string[] = [];
    const parser = new MllpParser();
    const client = net.createConnection({ host: '127.0.0.1', port: SRC_PORT_3 });
    client.on('data', (chunk: Buffer) => { answers.push(...parser.parse(chunk)); });
    const closed = new Promise<void>((resolve) => { client.once('close', () => { resolve(); }); });
    client.write(Buffer.concat([wrapMllp(HL7_ADT), wrapMllp(HL7_ADT.replace('|12345|', '|BEHIND|'))]));
    await reached;

    const stopping = channel.runtime.stop();
    letGo();
    expect((await stopping).ok).toBe(true);
    await closed;

    expect(answers).toHaveLength(1);
    expect(answers[0]).toContain('MSA|AA|12345');
    expect(sink.received).toHaveLength(1);
    expect(channel.store.messageCount()).toBe(1);
  });
});

/** A partner that refuses every message. */
function refusing(): CaptureDestination {
  const destination = new CaptureDestination();
  vi.spyOn(destination, 'send').mockResolvedValue({ ok: true, value: { status: 'ERROR', content: '', errorMessage: 'partner refused it' }, error: null });
  return destination;
}

describe('a channel hand-off to a target where a destination fails (#414)', () => {
  const statusOf = (channel: DeployedChannel, metaDataId: number): string | undefined =>
    channel.store.connectorMessages.find((m) => m.metaDataId === metaDataId)?.status;

  it.each([
    ['answers before its destinations, from the queue', true, 'ALWAYS', 'with an error that its response mode does not report'],
    ['reports the failure, after a direct send that queues on failure', false, 'ON_FAILURE', 'with an ERROR status'],
  ] as const)('reads ERROR in the sender and is not sent again when the target %s', async (_how, answersBeforeDestinations, queueMode, why) => {
    const CH_A = `00000000-0000-0000-0000-handoff${answersBeforeDestinations ? 'b' : 'r'}000a`;
    const CH_B = `00000000-0000-0000-0000-handoff${answersBeforeDestinations ? 'b' : 'r'}000b`;
    const sink = new CaptureDestination();
    const port = await freePort();

    const target = await deployChannel({
      channelId: CH_B,
      dataType: 'RAW',
      source: new ChannelReceiver({ channelId: CH_B }),
      answersBeforeDestinations,
      destinations: [{ metaDataId: 1, name: 'Delivered', connector: sink }, { metaDataId: 2, name: 'Refused', connector: refusing() }],
    });
    const sender = await deployChannel({
      channelId: CH_A,
      dataType: 'HL7V2',
      source: mllpSource(port),
      destinations: [{
        metaDataId: 1, name: 'To B', queueMode, retryIntervalMs: 50,
        connector: new ChannelDispatcher({ targetChannelId: CH_B, waitForResponse: true }),
      }],
    });
    deployed.push(sender, target);

    await sendMllp(port, HL7_ADT);
    await vi.waitFor(() => { expect(statusOf(sender, 1)).toBe('ERROR'); }, DELIVERY_WAIT);

    expect(sender.store.contentOf(1, 1, CONTENT_TYPE.ERROR)).toContain(`recorded message 1 ${why}`);
    expect(target.store.messageCount()).toBe(1);
    expect(sink.received).toHaveLength(1);
  });
});

describe('cascade across channels (A → B → C), converting the payload at each hop', () => {
  it('routes HL7 into A, converts to JSON in B, to XML in C, delivering the final XML', async () => {
    const CH_A = '00000000-0000-0000-0000-cascade0000a';
    const CH_B = '00000000-0000-0000-0000-cascade0000b';
    const CH_C = '00000000-0000-0000-0000-cascade0000c';

    const sink = new CaptureDestination();

    // Deploy downstream first: a ChannelReceiver registers on start, and must exist before anything routes to it.
    const channelC = await deployChannel({
      channelId: CH_C,
      // RAW: msg stays the raw string so string-based XML editing is deterministic.
      dataType: 'RAW',
      source: new ChannelReceiver({ channelId: CH_C }),
      transformer: "return String(msg).replace('</patient>', '<final>C</final></patient>');",
      destinations: [{ metaDataId: 1, name: 'Sink', connector: sink }],
    });

    const channelB = await deployChannel({
      channelId: CH_B,
      // RAW: receive A's JSON string verbatim so JSON.parse sees a string.
      dataType: 'RAW',
      source: new ChannelReceiver({ channelId: CH_B }),
      transformer: [
        'const o = JSON.parse(String(msg));',
        "return '<patient><name>' + o.name + '</name><via>' + o.source + '</via></patient>';",
      ].join('\n'),
      destinations: [{
        metaDataId: 1,
        name: 'To C',
        dataType: 'XML',
        connector: new ChannelDispatcher({ targetChannelId: CH_C, waitForResponse: true }),
      }],
    });

    const channelA = await deployChannel({
      channelId: CH_A,
      dataType: 'HL7V2',
      source: mllpSource(SRC_PORT_2, { maxConnections: 10 }),
      transformer: [
        'const lines = String(msg).split(String.fromCharCode(13));',
        "const pid = lines.find((l) => l.indexOf('PID') === 0) || '';",
        "const name = pid.split('|')[5] || '';",
        "return JSON.stringify({ name: name, source: 'A' });",
      ].join('\n'),
      destinations: [{
        metaDataId: 1,
        name: 'To B',
        dataType: 'JSON',
        connector: new ChannelDispatcher({ targetChannelId: CH_B, waitForResponse: true }),
      }],
    });
    deployed.push(channelA, channelB, channelC);

    await sendMllp(SRC_PORT_2, HL7_ADT);
    await vi.waitFor(() => { expect(sink.received).toHaveLength(1); }, DELIVERY_WAIT);

    const finalXml = sink.lastContent() ?? '';
    expect(finalXml).toContain('<name>DOE^JOHN</name>');
    expect(finalXml).toContain('<via>A</via>');
    expect(finalXml).toContain('<final>C</final>');

    expect(channelA.store.messageCount()).toBe(1);
    expect(channelB.store.messageCount()).toBe(1);
    expect(channelC.store.messageCount()).toBe(1);
  });
});
