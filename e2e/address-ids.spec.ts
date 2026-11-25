// A channel's group decides who sees its messages, so the editor opened at an address typed in
// capitals must show the groups a choice would replace (#406, D-368).

import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData, postData, removeChannelsNamed } from './fixtures/api.js';

const CHANNEL = 'E2E Address In Capitals';
const GROUPS = ['E2E Capitals A', 'E2E Capitals B'] as const;

interface Group { readonly id: string; readonly name: string }
interface Membership { readonly channelId: string; readonly channelGroupId: string }

let api: APIRequestContext;
let id = '';
let groups: readonly Group[] = [];

async function removeRows(): Promise<void> {
  await removeChannelsNamed(api, CHANNEL);
  const left = (await getData<Group[]>(api, '/channel-groups')).filter((g) => GROUPS.some((name) => name === g.name));
  for (const group of left) await deleteOk(api, `/channel-groups/${group.id}`);
}

test.describe('A channel opened at an address in capitals', () => {
  test.beforeAll(async () => {
    api = await adminApi();
    await removeRows();
    ({ id } = await postData<{ id: string }>(api, '/channels', {
      name: CHANNEL, enabled: false, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'JAVASCRIPT', sourceConnectorProperties: { script: 'return [];' },
    }));
    groups = [
      await postData<Group>(api, '/channel-groups', { name: GROUPS[0] }),
      await postData<Group>(api, '/channel-groups', { name: GROUPS[1] }),
    ];
    const res = await api.put(`${API_BASE}/channels/${id}/groups`, { data: { groupIds: groups.map((g) => g.id) } });
    expect(res.ok(), await res.text()).toBeTruthy();
  });

  test.afterAll(async () => {
    await removeRows();
    await api?.dispose();
  });

  test('the editor names both groups before one is kept', async ({ page }) => {
    // A v4 id has a letter with odds of all but nothing, and without one there is no case to test.
    expect(id.toUpperCase()).not.toBe(id);
    await login(page);
    await page.goto(`/channels/${id.toUpperCase()}`);

    await expect(page.getByText(/^In 2 groups: .+\. Saving keeps only the group you choose\.$/)).toBeVisible();
    const field = page.getByRole('combobox', { name: 'Channel Group' });
    await expect(field).toHaveText(/^E2E Capitals [AB]$/);

    const shown = await field.textContent();
    const other = groups.find((g) => g.name !== shown);
    await field.click();
    await page.getByRole('option', { name: other?.name ?? '', exact: true }).click();

    await expect(page.getByText('Channel group updated')).toBeVisible();
    await expect(field).toHaveText(other?.name ?? '');
    const kept = (await getData<Membership[]>(api, '/channel-groups/memberships')).filter((m) => m.channelId === id);
    expect(kept.map((m) => m.channelGroupId)).toEqual([other?.id]);
  });
});
