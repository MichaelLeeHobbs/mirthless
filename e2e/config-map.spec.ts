import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData } from './fixtures/api.js';

const TEST_CATEGORY = 'e2e_category';
const TEST_NAME = 'e2e_config_key';
const TEST_VALUE = 'e2e_config_value';
const UPDATED_VALUE = `${TEST_VALUE}_updated`;
const ENTRY_PATH = `/config-map/${TEST_CATEGORY}/${TEST_NAME}`;

interface ConfigMapEntry { readonly category: string; readonly name: string; readonly value: string | null }

let api: APIRequestContext;

async function storedValue(): Promise<string | null> {
  const entries = await getData<ConfigMapEntry[]>(api, `/config-map?category=${TEST_CATEGORY}`);
  return entries.find((e) => e.name === TEST_NAME)?.value ?? null;
}

function entryRow(page: Page): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: TEST_NAME, exact: true }) });
}

async function openConfigMap(page: Page): Promise<void> {
  await page.goto('/config-map');
  await expect(page.getByRole('heading', { level: 1, name: 'Configuration Map' })).toBeVisible({ timeout: 10_000 });
}

test.describe('Config Map', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    await deleteOk(api, ENTRY_PATH);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to config map page', async ({ page }) => {
    await openConfigMap(page);
    for (const column of ['Category', 'Name', 'Value']) {
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Add Entry' })).toBeEnabled();
  });

  test('add a new config entry', async ({ page }) => {
    await openConfigMap(page);
    await page.getByRole('button', { name: 'Add Entry' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add Entry' })).toBeVisible();
    await dialog.getByLabel('Category').fill(TEST_CATEGORY);
    await dialog.getByLabel('Name').fill(TEST_NAME);
    await dialog.getByLabel('Value').fill(TEST_VALUE);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(entryRow(page).getByRole('cell', { name: TEST_VALUE, exact: true })).toBeVisible();
    await expect.poll(storedValue).toBe(TEST_VALUE);
  });

  test('new entry appears in the list', async ({ page }) => {
    await openConfigMap(page);
    const row = entryRow(page);
    await expect(row.getByText(TEST_CATEGORY, { exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: TEST_VALUE, exact: true })).toBeVisible();

    await page.getByRole('tab', { name: TEST_CATEGORY, exact: true }).click();
    await expect(page.getByRole('tab', { name: TEST_CATEGORY, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(row).toHaveCount(1);
    const bodyRows = page.locator('tbody').getByRole('row');
    await expect(bodyRows.filter({ hasNotText: TEST_CATEGORY })).toHaveCount(0);
  });

  test('edit a config entry', async ({ page }) => {
    await openConfigMap(page);
    await entryRow(page).getByRole('button', { name: 'Edit entry' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit Entry' })).toBeVisible();
    await expect(dialog.getByLabel('Category')).toBeDisabled();
    await expect(dialog.getByLabel('Name')).toBeDisabled();
    await dialog.getByLabel('Value').fill(UPDATED_VALUE);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(entryRow(page).getByRole('cell', { name: UPDATED_VALUE, exact: true })).toBeVisible();
    await expect.poll(storedValue).toBe(UPDATED_VALUE);
  });

  test('delete a config entry', async ({ page }) => {
    await openConfigMap(page);
    await entryRow(page).getByRole('button', { name: 'Delete entry' }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(`Delete "${TEST_CATEGORY}/${TEST_NAME}"?`);
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(entryRow(page)).toHaveCount(0);
    await expect.poll(storedValue).toBeNull();
    const res = await api.get(`${API_BASE}${ENTRY_PATH}`);
    expect(res.status()).toBe(404);
  });
});
