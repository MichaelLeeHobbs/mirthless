// S18: TCP Listener in Basic (non-MLLP) mode with STX/ETX framing.
// Gap doc 12 rank 3: partners that frame messages with other bytes.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, jsWriter } from './support/mirth-xml.js';
import { sendFramed } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16618;

scenario('S18 TCP listener accepts STX/ETX framed messages and answers in the same framing', async (api) => {
  const ids = await api.importAndDeploy(channelExport({
    id: mirthId(18),
    name: 'S18 Lab Instrument',
    source: { name: 'sourceConnector', ...tcpListener(PORT, { basic: true, startHex: '02', endHex: '03' }), inbound: 'HL7V2' },
    destinations: [{ name: 'Store', ...jsWriter('return;') }],
  }), ['S18 Lab Instrument']);

  const ack = await sendFramed(PORT, 'MSH|^~\\&|LAB|S18|VNS|V|20261110120000||ORU^R01|S18CTL|P|2.5\rOBX|1|NM|GLU||98', '\x02', '\x03');
  expect(ack).toContain('MSA|AA|S18CTL');
  await expect.poll(async () => (await api.messages(ids['S18 Lab Instrument']!)).total, { timeout: 10_000 }).toBe(1);
});
