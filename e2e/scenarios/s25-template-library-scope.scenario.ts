// S25: code template libraries apply only to the channels Mirth enabled them for.
// Found by the anti-gaming check: in the production backup a customer library
// and the core library both declare the same const, and Mirth enables the
// customer one for a single channel. Loaded into every channel, the two
// declarations collide and no channel that uses templates deploys.

import { expect } from '@playwright/test';
import { serverBackup, tcpListener, jsWriter, type ChannelSpec } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const NORTH = mirthId(25, 1);
const SOUTH = mirthId(25, 2);

const channel = (name: string, id: string, port: number): ChannelSpec => ({
  id,
  name,
  source: {
    name: 'sourceConnector',
    ...tcpListener(port, { responseVariable: 'Postprocessor' }),
    inbound: 'HL7V2',
    steps: [{ name: 'Label', script: "$c('label', siteLabel(msg.get('MSH.4')));" }],
  },
  destinations: [{ name: 'Store', ...jsWriter('return;') }],
  postprocessor: "return createACK(rawData, 'AA', $c('label'));",
});

const orm = (ctl: string): string => `MSH|^~\\&|RIS|SITE25|VNS|VNS|20261110120000||ORM^O01|${ctl}|P|2.3\rORC|NW|ACC025`;

scenario('S25 code template libraries apply only to the channels Mirth enabled them for', async (api) => {
  await api.importAndDeploy(serverBackup(
    [channel('S25 North Orders', NORTH, 16625), channel('S25 South Orders', SOUTH, 16635)],
    [
      {
        id: '5c0025aa-0000-4000-8000-000000000001', name: 'S25 North', enabledChannelIds: [NORTH],
        templates: [{ id: '5c0025aa-0000-4000-8000-000000000002', name: 'siteLabel', code: "const siteLabel = (code) => 'NORTH-' + code;" }],
      },
      {
        id: '5c0025aa-0000-4000-8000-000000000003', name: 'S25 South', enabledChannelIds: [SOUTH],
        templates: [{ id: '5c0025aa-0000-4000-8000-000000000004', name: 'siteLabel', code: "const siteLabel = (code) => 'SOUTH-' + code;" }],
      },
    ],
  ), ['S25 North Orders', 'S25 South Orders']);

  expect(await sendMllp(16625, orm('S25N'))).toContain('MSA|AA|S25N|NORTH-SITE25');
  expect(await sendMllp(16635, orm('S25S'))).toContain('MSA|AA|S25S|SOUTH-SITE25');
});
