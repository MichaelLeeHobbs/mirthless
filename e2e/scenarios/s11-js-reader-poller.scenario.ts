// S11: a JavaScript Reader poller keeps state between polls in $gc.
// Production pattern: "mirthEventPoller" / "Channels Monitor", which poll on an
// interval and remember where they left off in the global channel map.

import { expect } from '@playwright/test';
import { channelExport, jsReader, jsWriter } from './support/mirth-xml.js';
import { scenario, mirthId } from './support/scenario.js';

const POLLER = [
  "var n = $gc('ticks');",
  'n = (n == null ? 0 : n) + 1;',
  "globalChannelMap.put('ticks', n);",
  "return 'tick ' + n;",
].join('\n');

scenario('S11 JavaScript Reader polls on an interval and keeps a counter in $gc', async (api) => {
  const ids = await api.importAndDeploy(channelExport({
    id: mirthId(11),
    name: 'S11 Event Poller',
    source: { name: 'sourceConnector', ...jsReader(POLLER, 500), inbound: 'RAW' },
    destinations: [{ name: 'Audit', ...jsWriter('return;') }],
  }), ['S11 Event Poller']);
  const channelId = ids['S11 Event Poller']!;

  await expect.poll(async () => (await api.messages(channelId)).total, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
  const items = [...(await api.messages(channelId)).items].sort((a, b) => a.messageId - b.messageId).slice(0, 3);
  const raws: string[] = [];
  for (const m of items) {
    const d = await api.message(channelId, m.messageId);
    raws.push(d.connectors.find((c) => c.metaDataId === 0)?.content['raw'] ?? '');
  }
  expect(raws).toEqual(['tick 1', 'tick 2', 'tick 3']);
});
