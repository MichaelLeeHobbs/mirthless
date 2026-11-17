// ===========================================
// Who can access a channel E2E Tests (#266 slice 11)
// ===========================================
// An admin opens a channel's Access tab and sees who can reach it through a
// group-scoped assignment, exports the list as CSV, then looks back to a time
// before that assignment, rebuilt from the audit log.
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
/** A whole second after the user was created as a viewer and before the scoped assignment replaced that. */
let whileViewer: Date;

/** `when` as a datetime-local value to the second, in this machine's zone (the browser's). */
function localInput(when: Date): string {
  return new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
}

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
    // The field takes whole seconds and the audit rows carry the database's clock,
    // so leave most of a second on each side for the two clocks to differ.
    whileViewer = new Date(Math.ceil((Date.now() + 800) / 1000) * 1000);
    await expect.poll(() => Date.now() > whileViewer.getTime() + 800, { timeout: 5000 }).toBe(true);
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
    expect(csv.split('\r\n')[0]).toBe('As of,Person,Access,Permissions,Role,Scope,Until');
    expect(csv).toContain(`,${USERNAME},Assignment,`);
  });

  test('as of an earlier time, it shows the access held then', async ({ page }) => {
    await login(page);
    await page.goto(`/channels/${channelId}`);
    await page.getByRole('tab', { name: 'Access' }).click();
    const row = page.getByRole('row', { name: new RegExp(USERNAME) });
    await expect(row).toContainText('channel-viewer');

    // Before the scoped assignment the user was a viewer on every channel.
    await page.getByLabel('As of').fill(localInput(whileViewer));
    await expect(page.getByText(/^Through GalvaniGraph, as of /)).toBeVisible();
    await expect(row).toContainText('viewer · All channels');
    await expect(row).not.toContainText('channel-viewer');

    // Before any recorded history, the page says where the history starts.
    await page.getByLabel('As of').fill('2000-01-01T00:00:00');
    await expect(page.getByText(/history starts at/i)).toBeVisible();

    await page.getByRole('button', { name: 'Now' }).click();
    await expect(row).toContainText('channel-viewer');
  });
});
