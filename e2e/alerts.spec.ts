// ===========================================
// Alerts E2E Tests
// ===========================================
// Creates, edits, disables and deletes an alert of this spec's own through the
// UI, checking each change on the page and in the API.

import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, deleteOk, getData } from './fixtures/api.js';
import { TEST_ALERT } from './fixtures/test-data.js';

const UPDATED_NAME = `${TEST_ALERT.name} Updated`;

interface AlertRow { readonly id: string; readonly name: string; readonly description: string | null; readonly enabled: boolean }

let api: APIRequestContext;

/** This spec's alerts (names starting with TEST_ALERT.name) as the API lists them. */
async function ownAlerts(): Promise<readonly AlertRow[]> {
  const list = await getData<{ data: AlertRow[] }>(api, '/alerts?pageSize=100');
  return list.data.filter((a) => a.name.startsWith(TEST_ALERT.name));
}

test.describe('Alerts', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    for (const alert of await ownAlerts()) await deleteOk(api, `/alerts/${alert.id}`);
  });

  test.afterAll(async () => {
    for (const alert of await ownAlerts()) await deleteOk(api, `/alerts/${alert.id}`);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to alerts page', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Trigger' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Alert' })).toBeEnabled();
  });

  test('create alert', async ({ page }) => {
    await page.goto('/alerts');
    await page.getByRole('button', { name: 'Create Alert' }).click();
    await expect(page.getByRole('heading', { name: 'New Alert' })).toBeVisible();

    await page.getByLabel('Name', { exact: true }).fill(TEST_ALERT.name);
    await page.getByLabel('Description', { exact: true }).fill(TEST_ALERT.description);
    await page.getByRole('button', { name: 'Create', exact: true }).click();

    // A created alert reopens in edit mode at its own address, titled with its name.
    await expect(page).toHaveURL(/\/alerts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: TEST_ALERT.name })).toBeVisible();

    const saved = await ownAlerts();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: TEST_ALERT.name, description: TEST_ALERT.description, enabled: true });

    await page.goto('/alerts');
    await expect(page.getByRole('row', { name: new RegExp(TEST_ALERT.name) })).toContainText(TEST_ALERT.description);
  });

  test('edit alert', async ({ page }) => {
    await page.goto('/alerts');
    await page.getByRole('row', { name: new RegExp(TEST_ALERT.name) }).getByRole('button', { name: 'Edit alert' }).click();

    const nameField = page.getByLabel('Name', { exact: true });
    await expect(nameField).toHaveValue(TEST_ALERT.name);
    await nameField.fill(UPDATED_NAME);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Alert saved successfully.')).toBeVisible();

    await expect.poll(async () => (await ownAlerts()).map((a) => a.name)).toEqual([UPDATED_NAME]);
    await page.goto('/alerts');
    await expect(page.getByRole('link', { name: UPDATED_NAME, exact: true })).toBeVisible();
  });

  test('toggle alert enabled', async ({ page }) => {
    await page.goto('/alerts');

    // The Enabled column is a switch named after the alert; one click flips it.
    const row = page.getByRole('row', { name: new RegExp(UPDATED_NAME) });
    const toggle = row.getByRole('switch', { name: `Disable ${UPDATED_NAME}` });
    await expect(toggle).toBeChecked();
    await toggle.click();

    await expect(row.getByRole('switch', { name: `Enable ${UPDATED_NAME}` })).not.toBeChecked();
    await expect.poll(async () => (await ownAlerts())[0]?.enabled).toBe(false);
  });

  test('delete alert', async ({ page }) => {
    await page.goto('/alerts');

    const row = page.getByRole('row', { name: new RegExp(UPDATED_NAME) });
    await row.getByRole('button', { name: 'Delete alert' }).click();
    // Confirm in the in-app dialog, which names the alert.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(UPDATED_NAME);
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await ownAlerts()).length).toBe(0);
  });

  test('empty state when no alerts', async ({ page }) => {
    // The database is shared with other specs, so serve an empty list rather than rely on one.
    await page.route(/\/api\/v1\/alerts\?/, async (route) => {
      await route.fulfill({
        json: { success: true, data: { data: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } } },
      });
    });
    await page.goto('/alerts');

    await expect(page.getByText('No alerts configured')).toBeVisible();
    await expect(page.getByText('Create an alert to get notified when channel errors or events occur.')).toBeVisible();
  });

  test('validation on create', async ({ page }) => {
    await page.goto('/alerts');
    await page.getByRole('button', { name: 'Create Alert' }).click();
    await expect(page.getByRole('heading', { name: 'New Alert' })).toBeVisible();

    // Create with no name: the form flags the field and nothing is saved.
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page).toHaveURL(/\/alerts\/new$/);
  });
});
