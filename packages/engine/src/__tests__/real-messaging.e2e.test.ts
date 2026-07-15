// ===========================================
// Real-Messaging E2E: send messages THROUGH channels
// ===========================================
// These tests do what unit tests can't: push a real message in through a real
// source connector, let it run the full 8-stage pipeline (with real esbuild-
// compiled TS scripts + injected code templates), and assert on the transformed
// output that a real destination connector received — plus the persisted rows.
//
//   Test 1  TCP/MLLP in → TS source transformer (calls a FUNCTION code template)
//           → TCP/MLLP out. Asserts the wire output + RAW/SENT content rows.
//
//   Test 2  Cascade  A → B → C  over the in-memory Channel connector, converting
//           the payload at each hop (HL7 → JSON → XML), proving multi-channel
//           routing + per-channel transformation. This is the "silly but good"
//           cascade from the project vision.

import { describe, it, expect, afterEach } from 'vitest';
import { CONTENT_TYPE } from '@mirthless/core-models';
import {
  TcpMllpReceiver,
  TcpMllpDispatcher,
  ChannelReceiver,
  ChannelDispatcher,
  clearChannelRegistry,
} from '@mirthless/connectors';
import type { CodeTemplateData } from '../index.js';
import {
  deployChannel,
  teardownAll,
  CaptureDestination,
  type DeployedChannel,
} from './support/e2e-harness.js';
import { startMllpCaptureServer, sendMllp, type MllpCaptureServer } from './support/tcp-helpers.js';

// ----- Fixtures -----

const HL7_ADT = [
  'MSH|^~\\&|SENDER|FACILITY|RECEIVER|FACILITY|20260228120000||ADT^A01|12345|P|2.5',
  'EVN|A01|20260228120000',
  'PID|||12345^^^MRN||DOE^JOHN||19800101|M',
  'PV1||I|ICU^101^A',
].join('\r');

// A FUNCTION code template, authored in TypeScript, injected into the source
// transformer's scope. Exercises the template-injection + TS-compile path.
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

let deployed: DeployedChannel[] = [];
let captureServer: MllpCaptureServer | null = null;

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  if (captureServer) { captureServer.close(); captureServer = null; }
  clearChannelRegistry();
});

// ----- Test 1: real TCP in → TS+template transform → real TCP out -----

describe('real message through a single channel (TCP → transform → TCP)', () => {
  it('applies a TS transformer using a code template and delivers to a real TCP destination', async () => {
    captureServer = await startMllpCaptureServer(DEST_PORT_1);

    const channel = await deployChannel({
      channelId: '00000000-0000-0000-0000-realmsg00001',
      dataType: 'HL7V2',
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: SRC_PORT_1, maxConnections: 10 }),
      templates: [REDACT_TEMPLATE],
      // TS source transformer: uses the injected template, then appends a segment.
      transformer: [
        'const out: string = redactMrn(String(msg));',
        "return out + '\\rZZZ|processed';",
      ].join('\n'),
      destinations: [{
        metaDataId: 1,
        name: 'TCP Out',
        connector: new TcpMllpDispatcher({
          host: '127.0.0.1', port: DEST_PORT_1, maxConnections: 5, responseTimeout: 5_000,
        }),
      }],
    });
    deployed.push(channel);

    const ack = await sendMllp(SRC_PORT_1, HL7_ADT);
    expect(ack).toContain('MSH');

    // The destination server received the TRANSFORMED message off the wire.
    // Allow the async dispatch to settle.
    await viWaitFor(() => captureServer!.received.length === 1);
    const delivered = captureServer.received[0] ?? '';
    expect(delivered).toContain('REDACTED^^^MRN');
    expect(delivered).toContain('ZZZ|processed');
    expect(delivered).not.toContain('12345^^^MRN');

    // Persisted rows: RAW = original inbound, SENT = transformed outbound.
    expect(channel.store.messageCount()).toBe(1);
    const raw = channel.store.contentOf(1, 0, CONTENT_TYPE.RAW);
    expect(raw).toContain('12345^^^MRN');
    const sent = channel.store.contentOf(1, 1, CONTENT_TYPE.SENT);
    expect(sent).toContain('ZZZ|processed');
    expect(sent).toContain('REDACTED^^^MRN');
  });
});

// ----- Test 2: A → B → C cascade with per-hop conversion -----

describe('cascade across channels (A → B → C), converting the payload at each hop', () => {
  it('routes HL7 into A, converts to JSON in B, to XML in C, delivering the final XML', async () => {
    const CH_A = '00000000-0000-0000-0000-cascade0000a';
    const CH_B = '00000000-0000-0000-0000-cascade0000b';
    const CH_C = '00000000-0000-0000-0000-cascade0000c';

    const sink = new CaptureDestination();

    // Deploy C first so its ChannelReceiver is registered before B routes to it,
    // and B before A. (Registration happens on start, which deployChannel does.)
    const channelC = await deployChannel({
      channelId: CH_C,
      // RAW: msg stays the raw string so string-based XML editing is deterministic.
      dataType: 'RAW',
      source: new ChannelReceiver({ channelId: CH_C }),
      // C: tag the XML as having passed through C.
      transformer: "return String(msg).replace('</patient>', '<final>C</final></patient>');",
      destinations: [{ metaDataId: 1, name: 'Sink', connector: sink }],
    });

    const channelB = await deployChannel({
      channelId: CH_B,
      // RAW: receive A's JSON string verbatim so JSON.parse sees a string.
      dataType: 'RAW',
      source: new ChannelReceiver({ channelId: CH_B }),
      // B: JSON → XML.
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
      source: new TcpMllpReceiver({ host: '127.0.0.1', port: SRC_PORT_2, maxConnections: 10 }),
      // A: HL7 → JSON (pull PID-5 patient name).
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
    await viWaitFor(() => sink.received.length === 1);

    const finalXml = sink.lastContent() ?? '';
    expect(finalXml).toContain('<name>DOE^JOHN</name>');
    expect(finalXml).toContain('<via>A</via>');
    expect(finalXml).toContain('<final>C</final>');

    // Each channel processed exactly one message.
    expect(channelA.store.messageCount()).toBe(1);
    expect(channelB.store.messageCount()).toBe(1);
    expect(channelC.store.messageCount()).toBe(1);
  });
});

// ----- small polling helper (avoids a fixed sleep for async dispatch) -----

async function viWaitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error('viWaitFor: condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}
