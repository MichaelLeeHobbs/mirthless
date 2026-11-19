// Only this spec reads the global map, so clearing it is safe with specs running in parallel (D-289).

import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData } from './fixtures/api.js';

const TEST_KEY = 'e2e_test_key';
const TEST_VALUE = 'e2e_test_value';
const CLEAR_KEYS = ['e2e_clear_key_1', 'e2e_clear_key_2'] as const;

let api: APIRequestContext;

function entryRow(page: Page, key: string): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: key, exact: true }) });
}

async function globalMapKeys(): Promise<string[]> {
  const entries = await getData<Array<{ key: string }>>(api, '/global-map');
  return entries.map((e) => e.key);
}

test.describe('Global Map', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    for (const key of [TEST_KEY, ...CLEAR_KEYS]) await deleteOk(api, `/global-map/${key}`);
  });

  test.afterAll(async () => {
    for (const key of [TEST_KEY, ...CLEAR_KEYS]) await deleteOk(api, `/global-map/${key}`);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to global map page', async ({ page }) => {
    await page.goto('/global-map');
    await expect(page.getByRole('heading', { level: 1, name: 'Global Map' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Add Entry' })).toBeEnabled();
  });

  test('add a new key-value entry', async ({ page }) => {
    await page.goto('/global-map');
    await page.getByRole('button', { name: 'Add Entry' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add Entry' });
    await dialog.getByLabel('Key').fill(TEST_KEY);
    await dialog.getByLabel('Value').fill(TEST_VALUE);
    await dialog.getByRole('button', { name: 'Save' }).click();

    await expect(dialog).toBeHidden();
    await expect(entryRow(page, TEST_KEY)).toContainText(TEST_VALUE);
  });

  test('new entry appears in the list', async ({ page }) => {
    await page.goto('/global-map');
    await expect(entryRow(page, TEST_KEY)).toContainText(TEST_VALUE, { timeout: 10_000 });
    expect(await getData<{ value: string }>(api, `/global-map/${TEST_KEY}`)).toMatchObject({ value: TEST_VALUE });
  });

  test('delete an entry', async ({ page }) => {
    await page.goto('/global-map');
    await entryRow(page, TEST_KEY).getByRole('button', { name: 'Delete entry' }).click();

    const confirm = page.getByRole('dialog', { name: 'Delete Entry' });
    await expect(confirm).toContainText(TEST_KEY);
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(entryRow(page, TEST_KEY)).toHaveCount(0);
    await expect.poll(globalMapKeys).not.toContain(TEST_KEY);
  });

  test('clear all entries', async ({ page }) => {
    for (const key of CLEAR_KEYS) {
      const res = await api.put(`${API_BASE}/global-map/${key}`, { data: { value: 'to be cleared' } });
      expect(res.ok(), `PUT /global-map/${key} returned ${String(res.status())}`).toBeTruthy();
    }

    await page.goto('/global-map');
    for (const key of CLEAR_KEYS) await expect(entryRow(page, key)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Clear All' }).click();
    const confirm = page.getByRole('dialog', { name: 'Clear All Entries?' });
    await confirm.getByRole('button', { name: 'Clear All' }).click();

    await expect(confirm).toBeHidden();
    await expect(page.getByRole('heading', { name: 'No global map entries' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear All' })).toBeDisabled();
    expect(await globalMapKeys()).toEqual([]);
  });
});
