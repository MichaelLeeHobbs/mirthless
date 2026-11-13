// S26: a listener that responds before processing answers AA whatever happens next.
// Found by the anti-gaming check. Mirth's "Auto-generate (Before processing)"
// acknowledges the message as soon as it is received; the sender must not get
// AE for a failure that happens later, or it resends and the message is
// processed twice. The failure is still recorded on the message.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, jsWriter } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16626;

scenario('S26 a listener that responds before processing answers AA even when its transformer fails', async (api) => {
  const ids = await api.importAndDeploy(channelExport({
    id: mirthId(26),
    name: 'S26 Early ACK',
    source: {
      name: 'sourceConnector',
      ...tcpListener(PORT, { responseVariable: 'Auto-generate (Before processing)' }),
      inbound: 'HL7V2',
      steps: [{ name: 'Fails', script: "if (msg.get('ORC.2') == 'BAD') { throw new Error('cannot map order BAD'); }" }],
    },
    destinations: [{ name: 'Store', ...jsWriter('return;') }],
  }), ['S26 Early ACK']);
  const channelId = ids['S26 Early ACK']!;

  const ack = await sendMllp(PORT, 'MSH|^~\\&|RIS|SITE26|VNS|VNS|20261110120000||ORM^O01|S26CTL|P|2.3\rORC|NW|BAD');
  expect(ack).toContain('MSA|AA|S26CTL');

  await expect.poll(async () => (await api.messages(channelId)).items[0]?.connectors.find((c) => c.metaDataId === 0)?.status, { timeout: 10_000 })
    .toBe('ERROR');
});
