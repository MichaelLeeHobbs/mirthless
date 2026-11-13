// S27: a destination error records why it failed.
// Found by the anti-gaming check: a channel that responds from its destination
// ("Respond from" d1) marked the destination ERROR and answered AE, but stored
// no error text, so the message browser could not say what went wrong.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, jsWriter } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16627;

scenario('S27 a destination error records why it failed', async (api) => {
  const ids = await api.importAndDeploy(channelExport({
    id: mirthId(27),
    name: 'S27 Orders Gateway',
    source: { name: 'sourceConnector', ...tcpListener(PORT, { responseVariable: 'd1' }), inbound: 'HL7V2' },
    destinations: [{ name: 'Gateway', ...jsWriter("throw new Error('gateway refused order with 503');") }],
  }), ['S27 Orders Gateway']);
  const channelId = ids['S27 Orders Gateway']!;

  expect(await sendMllp(PORT, 'MSH|^~\\&|RIS|SITE27|VNS|VNS|20261110120000||ORM^O01|S27CTL|P|2.3\rORC|NW|ACC027')).toContain('MSA|AE|S27CTL');

  await expect.poll(async () => (await api.messages(channelId)).total, { timeout: 10_000 }).toBe(1);
  const { items } = await api.messages(channelId);
  const dest = (await api.message(channelId, items[0]!.messageId)).connectors.find((c) => c.metaDataId === 1)!;
  expect(dest.status).toBe('ERROR');
  const reason = ['error', 'processingError', 'responseError'].map((k) => dest.content[k] ?? '').join('\n');
  expect(reason).toContain('gateway refused order with 503');
});
