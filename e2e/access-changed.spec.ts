// ===========================================
// Access changed E2E Tests (#266 slice 10e)
// ===========================================
// A user whose access is narrowed while they work sees "Your access changed"
// and a channel that is now outside their access as "not found, or not in your
// access", never as a deleted channel.
//
// Users can't be deleted, so each run uses names of its own (D-289). Cleanup
// removes the channel, clears the user's access, disables them, and deletes
// the groups.

import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData, postData, removeChannel } from './fixtures/api.js';

const RUN_ID = Date.now().toString(36);
const USERNAME = `e2e-changed-${RUN_ID}`;
const PASSWORD = 'ChangedTest123!';

interface RoleRow { readonly id: string; readonly name: string }

let api: APIRequestContext;
let userId: string;
let labId: string;
let radId: string;
let channelId: string;
let viewerRoleId: string;

test.describe.serial('Access changed', () => {
  test.beforeAll(async () => {
    api = await adminApi();
    labId = (await postData<{ id: string }>(api, '/channel-groups', { name: `e2e-chg-lab-${RUN_ID}`, description: '' })).id;
    radId = (await postData<{ id: string }>(api, '/channel-groups', { name: `e2e-chg-rad-${RUN_ID}`, description: '' })).id;
    channelId = (await postData<{ id: string }>(api, '/channels', {
      name: `e2e-changed-${RUN_ID}`, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'CHANNEL', sourceConnectorProperties: {}, responseMode: 'NONE', groupId: labId,
    })).id;
    userId = (await postData<{ id: string }>(api, '/users', {
      username: USERNAME, email: `${USERNAME}@example.test`, password: PASSWORD, role: 'viewer',
    })).id;
    // The channel editor needs channels:write, which channel-developer holds.
    viewerRoleId = (await getData<RoleRow[]>(api, '/roles')).find((r) => r.name === 'channel-developer')!.id;
    const set = await api.put(`${API_BASE}/users/${userId}/assignments`, { data: { assignments: [{ roleId: viewerRoleId, groupIds: [labId] }] } });
    expect(set.ok()).toBeTruthy();
  });

  test.afterAll(async () => {
    if (channelId) await removeChannel(api, channelId);
    if (userId) {
      await api.put(`${API_BASE}/users/${userId}/assignments`, { data: { assignments: [] } });
      await deleteOk(api, `/users/${userId}`);
    }
    for (const id of [labId, radId]) if (id) await deleteOk(api, `/channel-groups/${id}`);
    await api.dispose();
  });

  test('a channel taken out of your access reads as such, with a notice', async ({ page }) => {
    await login(page, { username: USERNAME, password: PASSWORD });
    await page.goto(`/channels/${channelId}`);
    await expect(page.getByRole('heading', { name: `e2e-changed-${RUN_ID}` })).toBeVisible();

    // An admin moves the user to another group while they work.
    const moved = await api.put(`${API_BASE}/users/${userId}/assignments`, { data: { assignments: [{ roleId: viewerRoleId, groupIds: [radId] }] } });
    expect(moved.ok()).toBeTruthy();

    await page.reload();
    await expect(page.getByText(/Your access changed at/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/channels/${channelId}$`));
    // The channel query retries before it gives up, so allow for that.
    await expect(page.getByText('This channel was not found, or it is not in your access.')).toBeVisible({ timeout: 20_000 });
  });
});
