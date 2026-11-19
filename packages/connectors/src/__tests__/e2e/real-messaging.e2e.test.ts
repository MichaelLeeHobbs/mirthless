import { describe, it, expect, afterEach, vi } from 'vitest';
import { CONTENT_TYPE } from '@galvanigraph/core-models';
import {
  ChannelReceiver,
  ChannelDispatcher,
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

const SRC_PORT_1 = 17681;
const DEST_PORT_1 = 17682;
const SRC_PORT_2 = 17683;

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
    captureServer = await startMllpCaptureServer(DEST_PORT_1);

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
        connector: mllpDestination(DEST_PORT_1, { maxConnections: 5, responseTimeout: 5_000 }),
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
