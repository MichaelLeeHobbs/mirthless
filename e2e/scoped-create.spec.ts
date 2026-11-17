// ===========================================
// Scoped creation and library links E2E Tests (#266 slice 10d)
// ===========================================
// Someone who can change channels in two groups, but not on every channel,
// must say which group a new channel joins; the channel lands there. An admin
// links a code template library to chosen channels.
//
// Users can't be deleted, so each run uses names of its own (D-289). Cleanup
// removes the channel and library, clears the user's access, disables them,
// and deletes the groups.

import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData, postData, removeChannel } from './fixtures/api.js';

const RUN_ID = Date.now().toString(36);
const USERNAME = `e2e-scoped-${RUN_ID}`;
const PASSWORD = 'ScopedTest123!';
const CHANNEL = `e2e-scoped-channel-${RUN_ID}`;
const LIBRARY = `e2e-links-${RUN_ID}`;

interface RoleRow { readonly id: string; readonly name: string }
interface Membership { readonly channelGroupId: string; readonly channelId: string }
interface Library { readonly id: string; readonly name: string; readonly channelIds: readonly string[] | null }

let api: APIRequestContext;
let userId: string;
let labId: string;
let radId: string;
let channelId: string | undefined;
let libraryId: string | undefined;

test.describe.serial('Scoped creation and library links', () => {
  test.beforeAll(async () => {
    api = await adminApi();
    labId = (await postData<{ id: string }>(api, '/channel-groups', { name: `e2e-scoped-lab-${RUN_ID}`, description: '' })).id;
    radId = (await postData<{ id: string }>(api, '/channel-groups', { name: `e2e-scoped-rad-${RUN_ID}`, description: '' })).id;
    userId = (await postData<{ id: string }>(api, '/users', {
      username: USERNAME, email: `${USERNAME}@example.test`, password: PASSWORD, role: 'viewer',
    })).id;
    const developer = (await getData<RoleRow[]>(api, '/roles')).find((r) => r.name === 'channel-developer')!;
    const set = await api.put(`${API_BASE}/users/${userId}/assignments`, {
      data: { assignments: [{ roleId: developer.id, groupIds: [labId, radId] }] },
    });
    expect(set.ok()).toBeTruthy();
  });

  test.afterAll(async () => {
    if (channelId) await removeChannel(api, channelId);
    if (libraryId) await deleteOk(api, `/code-templates/libraries/${libraryId}`);
    if (userId) {
      await api.put(`${API_BASE}/users/${userId}/assignments`, { data: { assignments: [] } });
      await deleteOk(api, `/users/${userId}`);
    }
    for (const id of [labId, radId]) if (id) await deleteOk(api, `/channel-groups/${id}`);
    await api.dispose();
  });

  test('a writer in several groups chooses the group a new channel joins', async ({ page }) => {
    await login(page, { username: USERNAME, password: PASSWORD });
    await page.goto('/');
    await page.getByRole('button', { name: 'New Channel' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox', { name: 'Channel Name' }).fill(CHANNEL);
    const create = dialog.getByRole('button', { name: 'Create' });
    // Without a group the server would refuse, so the dialog does not offer Create yet.
    await expect(create).toBeDisabled();
    await dialog.getByRole('combobox', { name: 'Group' }).click();
    await page.getByRole('option', { name: `e2e-scoped-rad-${RUN_ID}` }).click();
    await create.click();

    await expect(page).toHaveURL(/\/channels\/[0-9a-f-]{36}$/);
    channelId = page.url().split('/').pop();
    const memberships = await getData<Membership[]>(api, '/channel-groups/memberships');
    expect(memberships.filter((m) => m.channelId === channelId).map((m) => m.channelGroupId)).toEqual([radId]);
  });

  test('link a code template library to chosen channels', async ({ page }) => {
    libraryId = (await postData<{ id: string }>(api, '/code-templates/libraries', { name: LIBRARY, description: '' })).id;
    await login(page);
    await page.goto('/code-templates');
    // Each library row is a button holding its name and its own action buttons.
    await page.getByRole('button').filter({ hasText: LIBRARY }).getByRole('button', { name: 'Edit library' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'Channels' }).click();
    await page.getByRole('option', { name: 'Chosen channels' }).click();
    await dialog.getByRole('combobox', { name: 'Linked channels' }).fill(CHANNEL);
    await page.getByRole('option', { name: CHANNEL }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await expect.poll(async () => (await getData<Library[]>(api, '/code-templates/libraries')).find((l) => l.id === libraryId)?.channelIds)
      .toEqual([channelId]);
  });
});
