// ===========================================
// Code Templates E2E Tests
// ===========================================
// Creates a library of this spec's own, adds a template to it, edits the
// template's name, contexts and code, then deletes the template and the
// library. Each step is checked in the tree and through the API.

import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, deleteOk, getData } from './fixtures/api.js';
import { TEST_LIBRARY, TEST_TEMPLATE } from './fixtures/test-data.js';

const NEW_TEMPLATE_NAME = 'New Template';

interface Library { readonly id: string; readonly name: string; readonly description: string | null }
interface Template { readonly name: string; readonly code: string; readonly contexts: readonly string[] }

let api: APIRequestContext;

async function testLibraries(): Promise<Library[]> {
  const libs = await getData<Library[]>(api, '/code-templates/libraries');
  return libs.filter((l) => l.name === TEST_LIBRARY.name);
}

/** The templates in this spec's library, read from the API. */
async function libraryTemplates(): Promise<Template[]> {
  const [lib] = await testLibraries();
  expect(lib, `Library "${TEST_LIBRARY.name}" not found`).toBeDefined();
  return getData<Template[]>(api, `/code-templates?libraryId=${lib?.id ?? ''}`);
}

/** The library's row in the tree (its add, edit and delete buttons sit inside it). */
function libraryRow(page: Page): Locator {
  return page.getByRole('button').filter({ hasText: TEST_LIBRARY.name });
}

/** A template's row in the tree, scoped to this spec's library. */
function templateItem(page: Page, name: string): Locator {
  return libraryRow(page).locator('..').getByRole('button', { name, exact: true });
}

async function openCodeTemplates(page: Page): Promise<void> {
  await page.goto('/code-templates');
  await expect(page.getByRole('heading', { name: 'Code Templates' })).toBeVisible();
}

test.describe('Code Templates', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    // Deleting a library deletes its templates too.
    for (const lib of await testLibraries()) {
      await deleteOk(api, `/code-templates/libraries/${lib.id}`);
    }
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to Code Templates page', async ({ page }) => {
    await openCodeTemplates(page);
    await expect(page.getByRole('button', { name: 'Library', exact: true })).toBeEnabled();
    await expect(page.getByText('Select a template from the library tree to edit it.')).toBeVisible();
  });

  test('create library', async ({ page }) => {
    await openCodeTemplates(page);
    await page.getByRole('button', { name: 'Library', exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Create Library' })).toBeVisible();
    await dialog.getByLabel('Name').fill(TEST_LIBRARY.name);
    await dialog.getByLabel('Description').fill(TEST_LIBRARY.description);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(libraryRow(page)).toHaveCount(1);
    await expect.poll(async () => (await testLibraries()).map((l) => l.description))
      .toEqual([TEST_LIBRARY.description]);
  });

  test('create template in library', async ({ page }) => {
    await openCodeTemplates(page);
    await libraryRow(page).getByRole('button', { name: 'Add template', exact: true }).click();

    // The new template opens in the editor and shows under the library.
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(NEW_TEMPLATE_NAME);
    await expect(templateItem(page, NEW_TEMPLATE_NAME)).toBeVisible();
    await expect.poll(async () => (await libraryTemplates()).map((t) => t.name)).toEqual([NEW_TEMPLATE_NAME]);
  });

  test('edit template code and contexts', async ({ page }) => {
    await openCodeTemplates(page);
    await templateItem(page, NEW_TEMPLATE_NAME).click();

    const nameField = page.getByLabel('Name', { exact: true });
    await expect(nameField).toHaveValue(NEW_TEMPLATE_NAME);
    await nameField.fill(TEST_TEMPLATE.name);
    await page.getByRole('checkbox', { name: 'Source Filter/Transformer', exact: true }).check();

    // Replace the code in one edit: typing key by key races the editor.
    const editor = page.locator('.monaco-editor').first();
    await expect(editor.locator('.view-line').first()).toBeVisible();
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(TEST_TEMPLATE.code);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Template saved')).toBeVisible();
    await expect(templateItem(page, TEST_TEMPLATE.name)).toBeVisible();
    await expect.poll(libraryTemplates).toEqual([
      expect.objectContaining({ name: TEST_TEMPLATE.name, code: TEST_TEMPLATE.code, contexts: ['SOURCE_FILTER_TRANSFORMER'] }),
    ]);
  });

  test('delete template', async ({ page }) => {
    await openCodeTemplates(page);
    await templateItem(page, TEST_TEMPLATE.name).click();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(TEST_TEMPLATE.name);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm.getByRole('heading', { name: 'Delete Template' })).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(templateItem(page, TEST_TEMPLATE.name)).toHaveCount(0);
    await expect(libraryRow(page).locator('..').getByText('No templates')).toBeVisible();
    await expect.poll(async () => (await libraryTemplates()).length).toBe(0);
  });

  test('delete library', async ({ page }) => {
    await openCodeTemplates(page);
    await libraryRow(page).getByRole('button', { name: 'Delete library', exact: true }).click();

    const confirm = page.getByRole('dialog');
    await expect(confirm).toContainText(`Delete library "${TEST_LIBRARY.name}" and all its templates?`);
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(libraryRow(page)).toHaveCount(0);
    await expect.poll(async () => (await testLibraries()).length).toBe(0);
  });
});
