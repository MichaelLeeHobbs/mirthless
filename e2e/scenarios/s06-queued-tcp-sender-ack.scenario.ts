// S06: a queued TCP Sender waits out a partner outage and validates the ACK.
// Production pattern: Gov per-site sender channels (queued TCP Sender, ACK
// validation on). While the partner is down the message stays queued; when it
// comes back the message is delivered once. A partner AE marks it ERROR.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, tcpSender } from './support/mirth-xml.js';
import { MllpSink, sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16606;
const SINK = 16656;

const oru = (ctl: string): string => [
  `MSH|^~\\&|VNS|VNS|GOV|GOV|20261110120000||ORU^R01|${ctl}|P|2.4`,
  'PID|||MRN006',
  'OBX|1|TX|IMP||Report text',
].join('\r');

scenario('S06 queued TCP sender delivers after an outage and errors on a NACK', async (api) => {
  const ids = await api.importAndDeploy(channelExport({
    id: mirthId(6),
    name: 'S06 Gov Sender',
    source: { name: 'sourceConnector', ...tcpListener(PORT), inbound: 'HL7V2' },
    destinations: [{
      name: 'MHS Genesis',
      ...tcpSender('127.0.0.1', String(SINK), { enabled: true, retryIntervalMillis: 1000, validateResponse: true }),
    }],
  }), ['S06 Gov Sender']);
  const channelId = ids['S06 Gov Sender']!;
  const destStatus = async (n: number): Promise<string> => {
    const list = await api.messages(channelId);
    const m = [...list.items].sort((a, b) => a.messageId - b.messageId)[n];
    return m?.connectors.find((c) => c.metaDataId === 1)?.status ?? 'NONE';
  };

  // Partner down: the message is accepted and queued.
  expect(await sendMllp(PORT, oru('S06A'))).toContain('MSA|AA|S06A');
  await expect.poll(() => destStatus(0), { timeout: 15_000 }).toBe('QUEUED');

  // Partner back: delivered exactly once.
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await expect.poll(() => destStatus(0), { timeout: 20_000 }).toBe('SENT');
    expect(sink.received.filter((m) => m.includes('|S06A|'))).toHaveLength(1);

    // Partner rejects: ACK validation marks the send ERROR.
    sink.ackCode = 'AE';
    expect(await sendMllp(PORT, oru('S06B'))).toContain('MSA|AA|S06B');
    await expect.poll(() => destStatus(1), { timeout: 15_000 }).toMatch(/ERROR|QUEUED/);
    expect(await destStatus(1)).not.toBe('SENT');
  } finally {
    await sink.close();
  }
});
