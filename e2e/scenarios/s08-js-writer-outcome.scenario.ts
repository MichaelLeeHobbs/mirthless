// S08: a JavaScript Writer reports its outcome.
// Production pattern: "Propelyx Orders" writer, which returns
// ResponseFactory.getSentResponse / getErrorResponse after calling an API.
// Rewritten for GalvaniFlow (D-244): a returned value is the SENT response and
// a thrown error makes the destination ERROR with that text.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, jsWriter } from './support/mirth-xml.js';
import { sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16608;

const WRITER = [
  "var accession = msg.get('ORC.2');",
  "if (accession == 'BAD') {",
  "  throw new Error('rejected by downstream');",
  '}',
  "return 'stored ' + accession;",
].join('\n');

const orm = (accession: string): string => [
  `MSH|^~\\&|RIS|SITE8|VNS|VNS|20261110120000||ORM^O01|S08${accession}|P|2.3`,
  `ORC|NW|${accession}`,
].join('\r');

scenario('S08 JavaScript Writer reports SENT with a reply, or ERROR by throwing', async (api) => {
  const ids = await api.importAndDeploy(channelExport({
    id: mirthId(8),
    name: 'S08 Orders Writer',
    source: { name: 'sourceConnector', ...tcpListener(PORT), inbound: 'HL7V2' },
    destinations: [{ name: 'Orders API', ...jsWriter(WRITER) }],
  }), ['S08 Orders Writer']);
  const channelId = ids['S08 Orders Writer']!;

  await sendMllp(PORT, orm('GOOD1'));
  await sendMllp(PORT, orm('BAD'));
  await expect.poll(async () => (await api.messages(channelId)).total, { timeout: 15_000 }).toBe(2);

  const items = [...(await api.messages(channelId)).items].sort((a, b) => a.messageId - b.messageId);
  const good = (await api.message(channelId, items[0]!.messageId)).connectors.find((c) => c.metaDataId === 1)!;
  const bad = (await api.message(channelId, items[1]!.messageId)).connectors.find((c) => c.metaDataId === 1)!;
  expect(good.status).toBe('SENT');
  expect(good.content['response'] ?? '').toContain('stored GOOD1');
  expect(bad.status).toBe('ERROR');
  expect(`${bad.content['error'] ?? ''}${bad.content['response'] ?? ''}`).toContain('rejected by downstream');
});
