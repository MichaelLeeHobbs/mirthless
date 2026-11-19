import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData, postData, removeChannelsNamed } from './fixtures/api.js';

const CREATED_CHANNEL = 'E2E CRUD Channel';
const CREATED_DESCRIPTION = 'Created by E2E test';
const MENU_CHANNEL = 'E2E CRUD Menu Channel';
const DELETE_CHANNEL = 'E2E Delete Channel';
const GROUP = 'E2E CRUD Group';
const COLUMNS_PREF = 'dashboard.columns';

interface Preference { readonly key: string; readonly value: string | null }

let api: APIRequestContext;
let menuChannelId = '';
let savedColumns: string | null = null;

async function createChannel(name: string): Promise<string> {
  const created = await postData<{ id: string }>(api, '/channels', {
    name,
    enabled: false,
    inboundDataType: 'RAW',
    outboundDataType: 'RAW',
    sourceConnectorType: 'TCP_MLLP',
    sourceConnectorProperties: {},
  });
  return created.id;
}

async function removeGroupsNamed(name: string): Promise<void> {
  for (const group of await getData<Array<{ id: string; name: string }>>(api, '/channel-groups')) {
    if (group.name === name) await deleteOk(api, `/channel-groups/${group.id}`);
  }
}

async function columnsPreference(): Promise<string | null> {
  const prefs = await getData<Preference[]>(api, '/users/me/preferences');
  return prefs.find((p) => p.key === COLUMNS_PREF)?.value ?? null;
}

// Names are matched whole, so one name never matches another.
function channelRow(page: Page, name: string): ReturnType<Page['locator']> {
  return page.getByRole('row').filter({ has: page.getByRole('button', { name, exact: true }) });
}

async function openChannelMenu(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await channelRow(page, name).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
}

test.describe('Channel CRUD (Dashboard)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    for (const name of [CREATED_CHANNEL, MENU_CHANNEL, DELETE_CHANNEL]) await removeChannelsNamed(api, name);
    await removeGroupsNamed(GROUP);
    menuChannelId = await createChannel(MENU_CHANNEL);
    await postData(api, '/channel-groups', { name: GROUP });

    // Start from the default columns; the admin's own choice is put back afterwards.
    savedColumns = await columnsPreference();
    await deleteOk(api, `/users/me/preferences/${COLUMNS_PREF}`);
  });

  test.afterAll(async () => {
    for (const name of [CREATED_CHANNEL, MENU_CHANNEL, DELETE_CHANNEL]) await removeChannelsNamed(api, name);
    await removeGroupsNamed(GROUP);
    if (savedColumns === null) {
      await deleteOk(api, `/users/me/preferences/${COLUMNS_PREF}`);
    } else {
      const res = await api.put(`${API_BASE}/users/me/preferences`, { data: { key: COLUMNS_PREF, value: savedColumns } });
      expect(res.ok(), `Restoring ${COLUMNS_PREF} returned ${String(res.status())}`).toBeTruthy();
    }
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard loads and /channels redirects to it', async ({ page }) => {
    await page.goto('/channels');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('create channel via the New Channel dialog', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New Channel' }).click();

    const dialog = page.getByRole('dialog', { name: 'New Channel' });
    await dialog.getByLabel('Channel Name').fill(CREATED_CHANNEL);
    await dialog.getByLabel('Description').fill(CREATED_DESCRIPTION);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(page).toHaveURL(/\/channels\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: CREATED_CHANNEL })).toBeVisible();

    const id = /\/channels\/([0-9a-f-]{36})$/.exec(page.url())?.[1] ?? '';
    const saved = await getData<{ name: string; description: string; enabled: boolean }>(api, `/channels/${id}`);
    expect(saved).toMatchObject({ name: CREATED_CHANNEL, description: CREATED_DESCRIPTION, enabled: false });
  });

  test('empty name fails validation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New Channel' }).click();

    const dialog = page.getByRole('dialog', { name: 'New Channel' });
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog.getByText('Name is required')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('channel name navigates to the message browser (not the editor)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: MENU_CHANNEL, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/channels/${menuChannelId}/messages$`));
  });

  test('Edit from the context menu opens the editor', async ({ page }) => {
    await openChannelMenu(page, MENU_CHANNEL);
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/channels/${menuChannelId}$`));
    await expect(page.getByRole('heading', { name: MENU_CHANNEL })).toBeVisible();
  });

  test('context menu no longer offers Statistics', async ({ page }) => {
    await openChannelMenu(page, MENU_CHANNEL);
    await expect(page.getByRole('menuitem', { name: 'Messages' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Statistics' })).toHaveCount(0);
  });

  test('enable/disable from the context menu', async ({ page }) => {
    await openChannelMenu(page, MENU_CHANNEL);
    await page.getByRole('menuitem', { name: 'Enable', exact: true }).click();
    await expect.poll(async () => (await getData<{ enabled: boolean }>(api, `/channels/${menuChannelId}`)).enabled).toBe(true);

    await openChannelMenu(page, MENU_CHANNEL);
    await page.getByRole('menuitem', { name: 'Disable', exact: true }).click();
    await expect.poll(async () => (await getData<{ enabled: boolean }>(api, `/channels/${menuChannelId}`)).enabled).toBe(false);
  });

  test('delete a channel via the context menu + confirm dialog', async ({ page }) => {
    const id = await createChannel(DELETE_CHANNEL);
    await openChannelMenu(page, DELETE_CHANNEL);
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete Channel' });
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(channelRow(page, DELETE_CHANNEL)).toHaveCount(0);
    await expect.poll(async () => (await api.get(`${API_BASE}/channels/${id}`)).status()).toBe(404);
  });

  test('search filters channels in the flat view', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'flat view' }).click();
    const search = page.getByPlaceholder('Search channels...');

    await search.fill(MENU_CHANNEL);
    await expect(page.getByRole('button', { name: MENU_CHANNEL, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: CREATED_CHANNEL, exact: true })).toHaveCount(0);

    await search.fill('nonexistent_channel_xyz');
    await expect(page.getByText('No channels match your search.')).toBeVisible();
    await expect(page.getByRole('button', { name: MENU_CHANNEL, exact: true })).toHaveCount(0);
  });

  test('group header right-click opens the group menu (not the channel menu)', async ({ page }) => {
    await page.goto('/');
    // Grouped view is the default.
    await page.getByText(`${GROUP} (0)`, { exact: true }).click({ button: 'right' });

    await expect(page.getByRole('menuitem', { name: GROUP, exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Deploy all', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
  });

  test('configurable columns: toggle the Source column', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('columnheader', { name: 'Source' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('menuitem', { name: 'Source' }).click();
    // The open menu hides the page from the accessibility tree; close it first.
    await page.keyboard.press('Escape');

    await expect(page.getByRole('columnheader', { name: 'Source' })).toBeVisible();
    await expect.poll(async () => JSON.parse(await columnsPreference() ?? '[]') as string[]).toContain('source');
  });
});
