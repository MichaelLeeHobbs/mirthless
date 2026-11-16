// ===========================================
// Data Sources E2E Tests
// ===========================================
// Creates, edits and deletes a data source of this spec's own, and checks
// that the password is write-only: never sent back by the API and never
// pre-filled in the edit dialog.

import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, deleteOk, getData } from './fixtures/api.js';

const TEST_DS_NAME = 'E2E Test DataSource';
const INCOMPLETE_DS_NAME = `${TEST_DS_NAME} Incomplete`;

let api: APIRequestContext;

/** This spec's data sources as the API lists them. */
async function testDataSources(): Promise<Array<Record<string, unknown> & { id: string; name: string }>> {
  const sources = await getData<Array<Record<string, unknown> & { id: string; name: string }>>(api, '/datasources');
  return sources.filter((d) => d.name.startsWith(TEST_DS_NAME));
}

/** The table row for a data source, matched on its exact name cell. */
function sourceRow(page: Page, name: string): Locator {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

async function openDataSources(page: Page): Promise<void> {
  await page.goto('/datasources');
  await expect(page.getByRole('heading', { level: 1, name: 'Data Sources' })).toBeVisible({ timeout: 10_000 });
}

test.describe('Data Sources', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    for (const d of await testDataSources()) {
      await deleteOk(api, `/datasources/${d.id}`);
    }
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to data sources page', async ({ page }) => {
    await openDataSources(page);
    for (const column of ['Name', 'Connection', 'User', 'Mode', 'Actions']) {
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Create Data Source' })).toBeEnabled();
  });

  test('create a read-only data source', async ({ page }) => {
    await openDataSources(page);
    await page.getByRole('button', { name: 'Create Data Source' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Create Data Source' })).toBeVisible();
    await dialog.getByLabel('Name').fill(TEST_DS_NAME);
    await dialog.getByLabel('Host').fill('localhost');
    await dialog.getByLabel('Database').fill('galvaniflow');
    await dialog.getByLabel('User').fill('galvaniflow');
    await dialog.getByLabel('Password').fill('galvaniflow_dev');
    // Read-only is the default.
    await expect(dialog.getByLabel('Read-only (recommended)')).toBeChecked();
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    const row = sourceRow(page, TEST_DS_NAME);
    await expect(row.getByText('localhost:5432/galvaniflow', { exact: true })).toBeVisible();
    await expect(row.getByText('Read-only', { exact: true })).toBeVisible();

    await expect.poll(async () => (await testDataSources()).length).toBe(1);
    const [stored] = await testDataSources();
    expect(stored).toMatchObject({ host: 'localhost', port: 5432, database: 'galvaniflow', user: 'galvaniflow', readOnly: true });
    expect(stored).not.toHaveProperty('password');
  });

  test('password field is never pre-filled on edit', async ({ page }) => {
    await openDataSources(page);
    await sourceRow(page, TEST_DS_NAME).getByRole('button', { name: 'Edit data source' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit Data Source' })).toBeVisible();
    // The other fields load from the stored row; the password does not.
    await expect(dialog.getByLabel('Host')).toHaveValue('localhost');
    await expect(dialog.getByLabel('User')).toHaveValue('galvaniflow');
    await expect(dialog.getByLabel('Password (leave blank to keep)')).toHaveValue('');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('create stays disabled until required fields are filled', async ({ page }) => {
    await openDataSources(page);
    await page.getByRole('button', { name: 'Create Data Source' }).click();

    const dialog = page.getByRole('dialog');
    const create = dialog.getByRole('button', { name: 'Create', exact: true });
    await dialog.getByLabel('Name').fill(INCOMPLETE_DS_NAME);
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Host').fill('localhost');
    await dialog.getByLabel('Database').fill('galvaniflow');
    await dialog.getByLabel('User').fill('galvaniflow');
    // Still disabled: a new data source needs a password.
    await expect(create).toBeDisabled();
    await dialog.getByLabel('Password').fill('galvaniflow_dev');
    await expect(create).toBeEnabled();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(sourceRow(page, INCOMPLETE_DS_NAME)).toHaveCount(0);
    expect((await testDataSources()).map((d) => d.name)).toEqual([TEST_DS_NAME]);
  });

  test('delete a data source with confirmation', async ({ page }) => {
    await openDataSources(page);
    const row = sourceRow(page, TEST_DS_NAME);
    await row.getByRole('button', { name: 'Delete data source' }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(`Delete data source "${TEST_DS_NAME}"?`);
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await testDataSources()).length).toBe(0);
  });
});
