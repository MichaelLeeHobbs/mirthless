import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, deleteOk, getData } from './fixtures/api.js';

const TEST_TAG_NAME = 'E2E Test Tag';
const UPDATED_TAG_NAME = `${TEST_TAG_NAME} Updated`;
const TEST_TAG_COLOR = '#1976d2';

let api: APIRequestContext;

function tagRow(page: Page, name: string): Locator {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
}

async function tagNames(): Promise<string[]> {
  const tags = await getData<Array<{ name: string }>>(api, '/tags');
  return tags.map((t) => t.name);
}

async function removeTestTags(): Promise<void> {
  const tags = await getData<Array<{ id: string; name: string }>>(api, '/tags');
  for (const tag of tags) {
    if (tag.name.startsWith(TEST_TAG_NAME)) await deleteOk(api, `/tags/${tag.id}`);
  }
}

test.describe('Tags', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    await removeTestTags();
  });

  test.afterAll(async () => {
    await removeTestTags();
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to tags page', async ({ page }) => {
    await page.goto('/tags');
    await expect(page.getByRole('heading', { level: 1, name: 'Tags' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Create Tag' })).toBeEnabled();
  });

  test('create a new tag', async ({ page }) => {
    await page.goto('/tags');
    await page.getByRole('button', { name: 'Create Tag' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create Tag' });
    await dialog.getByLabel('Name').fill(TEST_TAG_NAME);
    await dialog.getByLabel('Color').fill(TEST_TAG_COLOR);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(tagRow(page, TEST_TAG_NAME)).toContainText(TEST_TAG_COLOR);
  });

  test('new tag appears in list', async ({ page }) => {
    await page.goto('/tags');
    const row = tagRow(page, TEST_TAG_NAME);
    await expect(row).toContainText(TEST_TAG_COLOR, { timeout: 10_000 });
    await expect(row.getByRole('cell').nth(2)).toHaveText('0');
  });

  test('edit tag name', async ({ page }) => {
    await page.goto('/tags');
    await tagRow(page, TEST_TAG_NAME).getByRole('button', { name: 'Edit tag' }).click();

    const dialog = page.getByRole('dialog', { name: 'Edit Tag' });
    await expect(dialog.getByLabel('Name')).toHaveValue(TEST_TAG_NAME);
    await dialog.getByLabel('Name').fill(UPDATED_TAG_NAME);
    await dialog.getByRole('button', { name: 'Update' }).click();

    await expect(dialog).toBeHidden();
    await expect(tagRow(page, UPDATED_TAG_NAME)).toContainText(TEST_TAG_COLOR);
    await expect(tagRow(page, TEST_TAG_NAME)).toHaveCount(0);
  });

  test('delete tag with confirmation', async ({ page }) => {
    await page.goto('/tags');
    await tagRow(page, UPDATED_TAG_NAME).getByRole('button', { name: 'Delete tag' }).click();

    const confirm = page.getByRole('dialog', { name: 'Delete Tag' });
    await expect(confirm).toContainText(UPDATED_TAG_NAME);
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(tagRow(page, UPDATED_TAG_NAME)).toHaveCount(0);
    await expect.poll(tagNames).not.toContain(UPDATED_TAG_NAME);
  });

  test('empty state shown when no tags', async ({ page }) => {
    // Other specs may have tags of their own, so the list is stubbed empty.
    await page.route('**/api/v1/tags', (route) => route.fulfill({ json: { success: true, data: [] } }));
    await page.goto('/tags');
    await expect(page.getByRole('heading', { name: 'No tags yet' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Create a tag to organize and filter your channels.')).toBeVisible();
  });
});
