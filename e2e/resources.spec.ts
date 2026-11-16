// ===========================================
// Resources E2E Tests
// ===========================================
// Creates, edits and deletes a resource of this spec's own through the UI,
// checking each change on the page and in the API.

import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, deleteOk, getData } from './fixtures/api.js';

const TEST_RESOURCE_NAME = 'E2E Test Resource';
const UPDATED_NAME = `${TEST_RESOURCE_NAME} Updated`;
const DESCRIPTION = 'Created by E2E test';
/** 20 bytes, which the list shows as "20.0 B". */
const CONTENT = 'e2e-resource-content';

interface ResourceRow { readonly id: string; readonly name: string }

let api: APIRequestContext;

/** This spec's resources (names starting with TEST_RESOURCE_NAME) as the API lists them. */
async function ownResources(): Promise<readonly ResourceRow[]> {
  const list = await getData<ResourceRow[]>(api, '/resources');
  return list.filter((r) => r.name.startsWith(TEST_RESOURCE_NAME));
}

test.describe('Resources', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    for (const resource of await ownResources()) await deleteOk(api, `/resources/${resource.id}`);
  });

  test.afterAll(async () => {
    for (const resource of await ownResources()) await deleteOk(api, `/resources/${resource.id}`);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to resources page', async ({ page }) => {
    await page.goto('/resources');
    await expect(page.getByRole('heading', { name: 'Resources', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'MIME Type' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Resource' })).toBeEnabled();
  });

  test('create a new resource', async ({ page }) => {
    await page.goto('/resources');
    await page.getByRole('button', { name: 'Create Resource' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create Resource' });
    await dialog.getByLabel('Name', { exact: true }).fill(TEST_RESOURCE_NAME);
    await dialog.getByLabel('Description', { exact: true }).fill(DESCRIPTION);
    await dialog.getByLabel('Content', { exact: true }).fill(CONTENT);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog).toBeHidden();
    const row = page.getByRole('row', { name: new RegExp(TEST_RESOURCE_NAME) });
    await expect(row).toContainText(DESCRIPTION);
    await expect.poll(async () => (await ownResources()).map((r) => r.name)).toEqual([TEST_RESOURCE_NAME]);
  });

  test('new resource appears in list', async ({ page }) => {
    await page.goto('/resources');

    // A fresh load shows the saved row: name, description, default MIME type and content size.
    const row = page.getByRole('row', { name: new RegExp(TEST_RESOURCE_NAME) });
    await expect(row.getByRole('cell')).toHaveText([TEST_RESOURCE_NAME, DESCRIPTION, 'text/plain', '20.0 B', '']);
  });

  test('edit resource', async ({ page }) => {
    await page.goto('/resources');
    await page.getByRole('row', { name: new RegExp(TEST_RESOURCE_NAME) }).getByRole('button', { name: 'Edit resource' }).click();

    const dialog = page.getByRole('dialog', { name: 'Edit Resource' });
    // The content loads separately; wait for it so the update doesn't save an empty body.
    await expect(dialog.getByLabel('Content', { exact: true })).toHaveValue(CONTENT);
    const nameField = dialog.getByLabel('Name', { exact: true });
    await expect(nameField).toHaveValue(TEST_RESOURCE_NAME);
    await nameField.fill(UPDATED_NAME);
    await dialog.getByRole('button', { name: 'Update', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByRole('cell', { name: UPDATED_NAME, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: TEST_RESOURCE_NAME, exact: true })).toHaveCount(0);

    const [saved] = await ownResources();
    expect(saved?.name).toBe(UPDATED_NAME);
    const detail = await getData<{ content: string }>(api, `/resources/${saved?.id ?? ''}`);
    expect(detail.content).toBe(CONTENT);
  });

  test('delete resource with confirmation', async ({ page }) => {
    await page.goto('/resources');

    const row = page.getByRole('row', { name: new RegExp(UPDATED_NAME) });
    await row.getByRole('button', { name: 'Delete resource' }).click();

    const dialog = page.getByRole('dialog', { name: 'Delete Resource' });
    await expect(dialog).toContainText(UPDATED_NAME);
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await ownResources()).length).toBe(0);
  });

  test('empty state shown when no resources', async ({ page }) => {
    // The database is shared with other specs, so serve an empty list rather than rely on one.
    await page.route((url) => url.pathname === '/api/v1/resources', async (route) => {
      await route.fulfill({ json: { success: true, data: [] } });
    });
    await page.goto('/resources');

    await expect(page.getByText('No resources yet')).toBeVisible();
    await expect(page.getByText('Create a resource to share files or libraries with your channel scripts.')).toBeVisible();
  });
});
