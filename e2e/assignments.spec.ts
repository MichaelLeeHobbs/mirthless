// ===========================================
// Assignments E2E Tests (#266 slice 10c)
// ===========================================
// An admin opens a user, adds access with a role on one channel group, and
// saves; the server then holds that assignment. A role that holds system-wide
// permissions cannot be given on groups, so the editor does not offer it.
//
// Users can't be deleted, so each run uses names of its own (D-289). Cleanup
// clears the user's access, disables them, and deletes the group.

import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData, postData } from './fixtures/api.js';

const RUN_ID = Date.now().toString(36);
const USERNAME = `e2e-access-${RUN_ID}`;
// Names of this spec's own: spec files run in parallel against one database (D-289).
const GROUP = `e2e-assign-lab-${RUN_ID}`;

interface Assignment { readonly roleName: string; readonly groupIds: readonly string[] | null; readonly reason: string | null }

let api: APIRequestContext;
let userId: string;
let groupId: string;

test.describe.serial('Assignments', () => {
  test.beforeAll(async () => {
    api = await adminApi();
    userId = (await postData<{ id: string }>(api, '/users', {
      username: USERNAME, email: `${USERNAME}@example.test`, password: 'AccessTest123!', role: 'viewer',
    })).id;
    groupId = (await postData<{ id: string }>(api, '/channel-groups', { name: GROUP, description: '' })).id;
  });

  test.afterAll(async () => {
    if (userId) {
      await api.put(`${API_BASE}/users/${userId}/assignments`, { data: { assignments: [] } });
      await deleteOk(api, `/users/${userId}`);
    }
    if (groupId) await deleteOk(api, `/channel-groups/${groupId}`);
    await api.dispose();
  });

  test('give a user a role on one channel group', async ({ page }) => {
    await login(page);
    await page.goto('/users');
    await page.getByRole('row', { name: new RegExp(USERNAME) }).getByRole('button', { name: 'Edit user' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit User' })).toBeVisible();
    // The user starts with the role they were created with, on every channel.
    await expect(dialog.getByRole('combobox', { name: 'Scope' })).toHaveText('All channels');

    await dialog.getByRole('button', { name: 'Add access' }).click();
    await dialog.getByRole('combobox', { name: 'Role' }).nth(1).click();
    // Viewer holds reads that reach every channel, so it cannot be given on groups.
    await page.getByRole('option', { name: 'Viewer', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Scope' }).nth(1).click();
    await expect(page.getByRole('option', { name: /^Chosen groups/ })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');

    await dialog.getByRole('combobox', { name: 'Role' }).nth(1).click();
    await page.getByRole('option', { name: 'Channel viewer', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Scope' }).nth(1).click();
    await page.getByRole('option', { name: 'Chosen groups', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Groups' }).fill(GROUP);
    await page.getByRole('option', { name: GROUP }).click();
    await dialog.getByRole('textbox', { name: 'Reason' }).nth(1).fill('Lab on-call');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => getData<Assignment[]>(api, `/users/${userId}/assignments`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ roleName: 'viewer', groupIds: null }),
      expect.objectContaining({ roleName: 'channel-viewer', groupIds: [groupId], reason: 'Lab on-call' }),
    ]));
  });

  test('saving other details later keeps the access just given', async ({ page }) => {
    await login(page);
    await page.goto('/users');
    await page.getByRole('row', { name: new RegExp(USERNAME) }).getByRole('button', { name: 'Edit user' }).click();
    const dialog = page.getByRole('dialog');
    // The list shows what the server holds now, both rows.
    await expect(dialog.getByRole('button', { name: 'Remove Channel viewer' })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Email' }).fill(`${USERNAME}+new@example.test`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    const after = await getData<Assignment[]>(api, `/users/${userId}/assignments`);
    expect(after).toHaveLength(2);
    expect(after).toEqual(expect.arrayContaining([expect.objectContaining({ roleName: 'channel-viewer', groupIds: [groupId] })]));
  });
});
