// Production pattern: Gov per-site sender channels (queued TCP Sender, ACK validation on).

import { expect } from '@playwright/test';
import { channelExport, tcpListener, tcpSender } from './support/mirth-xml.js';
import { MllpSink, sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16606;
const SINK = 16656;

const oru = (ctl: string): string => [
  `MSH|^~\\&|HUB|HUB|GOV|GOV|20261110120000||ORU^R01|${ctl}|P|2.4`,
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

  expect(await sendMllp(PORT, oru('S06A'))).toContain('MSA|AA|S06A');
  // The queue has taken it and the sender waits for a connection, which nothing accepts yet.
  await expect.poll(() => destStatus(0)).toBe('PENDING');

  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await expect.poll(() => destStatus(0)).toBe('SENT');
    expect(sink.received.filter((m) => m.includes('|S06A|'))).toHaveLength(1);

    sink.ackCode = 'AE';
    expect(await sendMllp(PORT, oru('S06B'))).toContain('MSA|AA|S06B');
    await expect.poll(() => sink.received.some((m) => m.includes('|S06B|'))).toBe(true);
    await expect.poll(() => destStatus(1)).toMatch(/ERROR|QUEUED/);
    expect(await destStatus(1)).not.toBe('SENT');
  } finally {
    await sink.close();
  }
});
