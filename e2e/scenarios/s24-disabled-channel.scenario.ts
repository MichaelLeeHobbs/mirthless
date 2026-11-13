// S24: a channel disabled in Mirth stays disabled after the import.
// Found by the anti-gaming check: the production backup has 3 disabled
// channels. Mirth 4.x keeps the flag in exportData/metadata; imported as
// enabled, such a channel would be deployed by the next server start and
// start taking messages nobody expects it to take.

import { expect } from '@playwright/test';
import { serverBackup, tcpListener, jsWriter, type ChannelSpec } from './support/mirth-xml.js';
import { API_BASE } from './support/api.js';
import { scenario, mirthId } from './support/scenario.js';

const channel = (name: string, slot: number, port: number, enabled: boolean): ChannelSpec => ({
  id: mirthId(24, slot),
  name,
  enabled,
  source: { name: 'sourceConnector', ...tcpListener(port), inbound: 'HL7V2' },
  destinations: [{ name: 'Store', ...jsWriter('return;') }],
});

scenario('S24 a channel disabled in Mirth is imported disabled', async (api) => {
  const ids = await api.importAndDeploy(
    serverBackup([channel('S24 Live Feed', 1, 16624, true), channel('S24 Retired Feed', 2, 16634, false)]),
    ['S24 Live Feed'],
  );
  expect((await api.get<{ enabled: boolean }>(`/channels/${ids['S24 Live Feed']!}`)).enabled).toBe(true);

  const retiredId = await api.channelId('S24 Retired Feed');
  expect((await api.get<{ enabled: boolean }>(`/channels/${retiredId}`)).enabled).toBe(false);
  const deploy = await api.ctx.post(`${API_BASE}/channels/${retiredId}/deploy`, { data: {} });
  expect(deploy.ok(), 'a disabled channel must not deploy').toBe(false);
});
