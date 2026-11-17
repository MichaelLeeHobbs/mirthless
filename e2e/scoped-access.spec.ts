// ===========================================
// Who can access a channel E2E Tests (#266 slice 11)
// ===========================================
// An admin opens a channel's Access tab and sees who can reach it through a
// group-scoped assignment, then exports the list as CSV.
//
// Users can't be deleted, so each run uses names of its own (D-289). Cleanup
// removes the channel, clears the user's access, disables them, and deletes
// the group.

import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData, postData, removeChannel } from './fixtures/api.js';

const RUN_ID = Date.now().toString(36);
const USERNAME = `e2e-access-view-${RUN_ID}`;
const CHANNEL = `e2e-access-view-${RUN_ID}`;

interface RoleRow { readonly id: string; readonly name: string }

let api: APIRequestContext;
let userId: string;
let groupId: string;
let channelId: string;

test.describe.serial('Who can access a channel', () => {
  test.beforeAll(async () => {
    api = await adminApi();
    groupId = (await postData<{ id: string }>(api, '/channel-groups', { name: `e2e-access-view-${RUN_ID}`, description: '' })).id;
    channelId = (await postData<{ id: string }>(api, '/channels', {
      name: CHANNEL, inboundDataType: 'RAW', outboundDataType: 'RAW',
      sourceConnectorType: 'CHANNEL', sourceConnectorProperties: {}, responseMode: 'NONE', groupId,
    })).id;
    userId = (await postData<{ id: string }>(api, '/users', {
      username: USERNAME, email: `${USERNAME}@example.test`, password: 'AccessView123!', role: 'viewer',
    })).id;
    const role = (await getData<RoleRow[]>(api, '/roles')).find((r) => r.name === 'channel-viewer')!;
    const set = await api.put(`${API_BASE}/users/${userId}/assignments`, { data: { assignments: [{ roleId: role.id, groupIds: [groupId], reason: 'e2e' }] } });
    expect(set.ok()).toBeTruthy();
  });

  test.afterAll(async () => {
    if (channelId) await removeChannel(api, channelId);
    if (userId) {
      await api.put(`${API_BASE}/users/${userId}/assignments`, { data: { assignments: [] } });
      await deleteOk(api, `/users/${userId}`);
    }
    if (groupId) await deleteOk(api, `/channel-groups/${groupId}`);
    await api.dispose();
  });

  test('the Access tab lists a group-scoped holder, and exports the list', async ({ page }) => {
    await login(page);
    await page.goto(`/channels/${channelId}`);
    await page.getByRole('tab', { name: 'Access' }).click();

    const row = page.getByRole('row', { name: new RegExp(USERNAME) });
    await expect(row).toContainText('Read messages');
    await expect(row).toContainText(`channel-viewer · e2e-access-view-${RUN_ID}`);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const file = await (await download).path();
    const csv = await readFile(file, 'utf8');
    expect(csv.split('\r\n')[0]).toBe('Person,Access,Permissions,Role,Scope,Until');
    expect(csv).toContain(`${USERNAME},Assignment,`);
  });
});
