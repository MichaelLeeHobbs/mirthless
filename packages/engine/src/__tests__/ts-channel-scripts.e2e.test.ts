// ===========================================
// TypeScript channel scripts — compiled + run end to end
// ===========================================
// Proves that channel scripts authored in real TypeScript (interfaces, generics,
// typed helpers, `as const`) are transpiled by the production esbuild path and
// run correctly through a live channel. The ambient types an author writes these
// against ship in packages/engine/sandbox-globals.d.ts.

import { describe, it, expect, afterEach } from 'vitest';
import { TcpMllpReceiver, clearChannelRegistry } from '@mirthless/connectors';
import { deployChannel, teardownAll, CaptureDestination, type DeployedChannel } from './support/e2e-harness.js';
import { sendMllp } from './support/tcp-helpers.js';

const HL7 = [
  'MSH|^~\\&|S|F|R|F|20260101||ADT^A01|1|P|2.5',
  'PID|||99887^^^MRN||SMITH^JANE||19700101|F',
].join('\r');

let deployed: DeployedChannel[] = [];

afterEach(async () => {
  await teardownAll(deployed);
  deployed = [];
  clearChannelRegistry();
});

async function runScriptChannel(channelId: string, port: number, transformer: string): Promise<CaptureDestination> {
  const sink = new CaptureDestination();
  const channel = await deployChannel({
    channelId,
    dataType: 'RAW',
    source: new TcpMllpReceiver({ host: '127.0.0.1', port, maxConnections: 10 }),
    transformer,
    destinations: [{ metaDataId: 1, name: 'sink', connector: sink }],
  });
  deployed.push(channel);
  await sendMllp(port, HL7);
  // Poll for the async dispatch to land.
  for (let i = 0; i < 200 && sink.received.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return sink;
}

describe('TypeScript channel scripts run through a real channel', () => {
  it('transformer with an interface + typed helper (HL7 → typed JSON)', async () => {
    const transformer = [
      'interface Patient { readonly mrn: string; readonly name: string; }',
      'function parsePatient(hl7: string): Patient {',
      "  const pid = hl7.split(String.fromCharCode(13)).find((l: string) => l.startsWith('PID')) ?? '';",
      "  const fields: readonly string[] = pid.split('|');",
      "  const mrn: string = (fields[3] ?? '').split('^')[0] ?? '';",
      "  return { mrn, name: fields[5] ?? '' };",
      '}',
      'const p: Patient = parsePatient(String(msg));',
      'return JSON.stringify(p);',
    ].join('\n');

    const sink = await runScriptChannel('00000000-0000-0000-0000-tsscript0001', 17711, transformer);
    expect(sink.received).toHaveLength(1);
    const out = JSON.parse(sink.lastContent() ?? '{}') as { mrn: string; name: string };
    expect(out.mrn).toBe('99887');
    expect(out.name).toBe('SMITH^JANE');
  });

  it('transformer with a generic arrow + as-const union', async () => {
    const transformer = [
      'const at = <T>(arr: readonly T[], i: number): T | undefined => arr[i];',
      "const KIND = { ADT: 'ADT', ORU: 'ORU' } as const;",
      'type Kind = typeof KIND[keyof typeof KIND];',
      "const seg: string = at(String(msg).split(String.fromCharCode(13)), 0) ?? '';",
      "const kind: Kind = seg.includes('ADT') ? KIND.ADT : KIND.ORU;",
      "return kind + '|' + String(at(seg.split('|'), 9) ?? '');",
    ].join('\n');

    const sink = await runScriptChannel('00000000-0000-0000-0000-tsscript0002', 17712, transformer);
    expect(sink.received).toHaveLength(1);
    expect(sink.lastContent()).toContain('ADT|');
  });
});
