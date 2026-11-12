// S09: the target channel is chosen at run time.
// Production pattern: Gov "Message Router" (Channel Writer to
// ${destinationChannelId}) and channelUtils.routeJsonMsg (router.routeMessage
// by channel name).

import { expect } from '@playwright/test';
import { serverBackup, tcpListener, channelReader, channelWriter, jsWriter, type ChannelSpec } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16609;

const target = (name: string, slot: number): ChannelSpec => ({
  id: mirthId(9, slot),
  name,
  source: { name: 'sourceConnector', ...channelReader(), inbound: 'HL7V2' },
  destinations: [{ name: 'Done', ...jsWriter('return;') }],
});

const router: ChannelSpec = {
  id: mirthId(9, 9),
  name: 'S09 Router',
  source: {
    name: 'sourceConnector',
    ...tcpListener(PORT),
    inbound: 'HL7V2',
    steps: [{
      name: 'Pick target',
      script: [
        "var site = String(connectorMessage.getRawData()).split('\\r')[0].split('|')[5];",
        `channelMap.put('destinationChannelId', site == 'A' ? '${mirthId(9, 1)}' : '${mirthId(9, 2)}');`,
      ].join('\n'),
    }],
  },
  destinations: [
    { name: 'To site', ...channelWriter('${destinationChannelId}') },
    { name: 'Audit', ...jsWriter("router.routeMessage('S09 Audit', String(connectorMessage.getRawData()));\nreturn;") },
  ],
};

const msg = (site: string): string => `MSH|^~\\&|RIS|X|VNS|${site}|20261110120000||ORM^O01|S09${site}|P|2.3\rPID|||MRN009`;

scenario('S09 messages reach a channel picked at run time and an audit channel by name', async (api) => {
  const ids = await api.importAndDeploy(
    serverBackup([target('S09 Site A', 1), target('S09 Site B', 2), target('S09 Audit', 3), router]),
    ['S09 Site A', 'S09 Site B', 'S09 Audit', 'S09 Router'],
  );
  await sendMllp(PORT, msg('A'));
  await sendMllp(PORT, msg('B'));
  await sendMllp(PORT, msg('A'));

  await expect.poll(async () => (await api.messages(ids['S09 Audit']!)).total, { timeout: 15_000 }).toBe(3);
  expect((await api.messages(ids['S09 Site A']!)).total).toBe(2);
  expect((await api.messages(ids['S09 Site B']!)).total).toBe(1);
});
