// S10: custom metadata columns are filled and searchable.
// Production pattern: every channel carries ACCESSION / INSTITUTION columns
// mapped from channel-map variables, and operators find a study's messages by
// accession number.
//
// Search contract: GET /channels/:id/messages?metaDataColumn=<NAME>&metaDataValue=<v>
// returns only messages whose column equals the value, and each summary carries
// a `metaData` record of column values.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, jsWriter } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16610;

const orm = (accession: string): string => [
  `MSH|^~\\&|RIS|SITE10|VNS|VNS|20261110120000||ORM^O01|S10${accession}|P|2.3`,
  `ORC|NW|${accession}`,
].join('\r');

scenario('S10 messages are found by their ACCESSION metadata column', async (api) => {
  const ids = await api.importAndDeploy(channelExport({
    id: mirthId(10),
    name: 'S10 Orders',
    metaDataColumns: [
      { name: 'ACCESSION', type: 'STRING', mappingName: 'accession' },
      { name: 'INSTITUTION', type: 'STRING', mappingName: 'institution' },
    ],
    source: {
      name: 'sourceConnector',
      ...tcpListener(PORT),
      inbound: 'HL7V2',
      steps: [{
        name: 'Metadata',
        script: [
          "$c('accession', msg.get('ORC.2'));",
          "$c('institution', msg.get('MSH.4'));",
        ].join('\n'),
      }],
    },
    destinations: [{ name: 'Store', ...jsWriter('return;') }],
  }), ['S10 Orders']);
  const channelId = ids['S10 Orders']!;

  await sendMllp(PORT, orm('ACC-S10-1'));
  await sendMllp(PORT, orm('ACC-S10-2'));
  await expect.poll(async () => (await api.messages(channelId)).total, { timeout: 15_000 }).toBe(2);

  const found = await api.get<{ items: Array<{ messageId: number; metaData?: Record<string, unknown> }>; total: number }>(
    `/channels/${channelId}/messages?metaDataColumn=ACCESSION&metaDataValue=ACC-S10-2`,
  );
  expect(found.total).toBe(1);
  expect(found.items[0]?.metaData?.['ACCESSION']).toBe('ACC-S10-2');
  expect(found.items[0]?.metaData?.['INSTITUTION']).toBe('SITE10');
});
