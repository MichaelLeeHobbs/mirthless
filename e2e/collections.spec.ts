// ===========================================
// Collections E2E Tests
// ===========================================

import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, deleteOk, getData, postData } from './fixtures/api.js';

const TEST_COLLECTION_NAME = 'E2E Test Collection';
const INDEXED_FIELDS = ['accessionNumber', 'institutionName', 'orderControl'] as const;

let api: APIRequestContext;

interface CollectionSummary { readonly id: string; readonly name: string }

/** The collections table row whose name link reads exactly this name. */
function collectionRow(page: Page, name: string): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name, exact: true }) });
}

async function collectionNames(): Promise<string[]> {
  return (await getData<CollectionSummary[]>(api, '/collections')).map((c) => c.name);
}

/** Delete every collection whose name passes the test, from this run or an interrupted one. */
async function removeCollections(match: (name: string) => boolean): Promise<void> {
  for (const c of await getData<CollectionSummary[]>(api, '/collections')) {
    if (match(c.name)) await deleteOk(api, `/collections/${c.id}`);
  }
}

test.beforeAll(async () => {
  api = await adminApi();
});

test.afterAll(async () => {
  await api?.dispose();
});

test.describe('Collections', () => {
  test.describe.configure({ mode: 'serial' });

  // Exact names: the records grid below keeps its own collection, whose name shares this prefix.
  const ownNames = [TEST_COLLECTION_NAME, `${TEST_COLLECTION_NAME} NoFields`];

  test.beforeAll(async () => {
    await removeCollections((name) => ownNames.includes(name));
  });

  test.afterAll(async () => {
    await removeCollections((name) => ownNames.includes(name));
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to collections page', async ({ page }) => {
    await page.goto('/collections');
    await expect(page.getByRole('heading', { level: 1, name: 'Collections' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Create Collection' })).toBeEnabled();
  });

  test('create a collection with indexed fields and a TTL', async ({ page }) => {
    await page.goto('/collections');
    await page.getByRole('button', { name: 'Create Collection' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create Collection' });
    await dialog.getByLabel('Name').fill(TEST_COLLECTION_NAME);
    await dialog.getByLabel('Indexed Fields').fill(INDEXED_FIELDS.join(', '));
    await dialog.getByLabel(/Default TTL/i).fill('604800');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    // Appears in the list with its fields; a TTL of 604800 seconds renders as 7d.
    await expect(dialog).toBeHidden();
    const row = collectionRow(page, TEST_COLLECTION_NAME);
    for (const field of INDEXED_FIELDS) await expect(row.getByText(field, { exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: '7d', exact: true })).toBeVisible();
  });

  test('create is disabled without indexed fields', async ({ page }) => {
    await page.goto('/collections');
    await page.getByRole('button', { name: 'Create Collection' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Collection' });
    await dialog.getByLabel('Name').fill(`${TEST_COLLECTION_NAME} NoFields`);
    // No indexed fields entered → the Create button stays disabled.
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled();
    await dialog.getByLabel('Indexed Fields').fill('accession');
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeEnabled();
  });

  test('the collection name opens its records grid', async ({ page }) => {
    await page.goto('/collections');
    await page.getByRole('link', { name: TEST_COLLECTION_NAME, exact: true }).click();
    await expect(page).toHaveURL(/\/collections\/[0-9a-f-]+\/records$/);
    await expect(page.getByRole('heading', { name: TEST_COLLECTION_NAME })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('No records yet')).toBeVisible();
  });

  test('delete a collection with confirmation', async ({ page }) => {
    await page.goto('/collections');
    await collectionRow(page, TEST_COLLECTION_NAME).getByRole('button', { name: 'Delete collection' }).click();

    const confirm = page.getByRole('dialog', { name: 'Delete Collection' });
    await expect(confirm).toContainText(TEST_COLLECTION_NAME);
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(collectionRow(page, TEST_COLLECTION_NAME)).toHaveCount(0);
    await expect.poll(collectionNames).not.toContain(TEST_COLLECTION_NAME);
  });
});

// ----- Records grid -----

const GRID_COLLECTION_NAME = 'E2E Test Collection Records';

test.describe('Collection records grid', () => {
  test.describe.configure({ mode: 'serial' });
  let collectionId = '';

  // A fresh collection with three records, made through the API.
  test.beforeAll(async () => {
    await removeCollections((name) => name === GRID_COLLECTION_NAME);
    collectionId = (await postData<{ id: string }>(api, '/collections', { name: GRID_COLLECTION_NAME, indexedFields: ['accession', 'facility'] })).id;
    for (const [accession, facility, payload] of [['B200', 'North', 'second'], ['A100', 'South', 'first'], ['C300', 'North', 'third']]) {
      await postData(api, `/collections/${collectionId}/records`, { fields: { accession, facility }, payload });
    }
  });

  test.afterAll(async () => {
    await removeCollections((name) => name === GRID_COLLECTION_NAME);
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`/collections/${collectionId}/records`);
    await expect(page.getByRole('heading', { name: GRID_COLLECTION_NAME })).toBeVisible({ timeout: 10_000 });
  });

  const accessions = (page: Page): Promise<string[]> =>
    page.locator('table tbody tr td:first-child').allTextContents();

  test('sorts by an indexed field from its column head', async ({ page }) => {
    await expect(page.getByText('3 records')).toBeVisible();
    await page.getByRole('button', { name: 'accession' }).click();
    await expect.poll(() => accessions(page)).toEqual(['A100', 'B200', 'C300']);
    await page.getByRole('button', { name: 'accession' }).click();
    await expect.poll(() => accessions(page)).toEqual(['C300', 'B200', 'A100']);
  });

  test('filters with the search box', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Search records' }).fill('north');
    await expect(page.getByText('2 records found')).toBeVisible();
    await expect.poll(() => accessions(page)).toHaveLength(2);
    await page.getByRole('textbox', { name: 'Search records' }).fill('nothing-like-this');
    await expect(page.getByText('No matching records')).toBeVisible();
  });

  test('adds, edits and deletes a record', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Record' }).click();
    const add = page.getByRole('dialog', { name: 'Add record' });
    await add.getByLabel('accession').fill('Z900');
    await add.getByLabel('Payload').fill('added from e2e');
    await add.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(add).toBeHidden();
    await expect(page.getByRole('cell', { name: 'Z900' })).toBeVisible();
    await expect(page.getByText('4 records')).toBeVisible();

    await page.getByRole('cell', { name: 'Z900' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit record' });
    await edit.getByLabel('accession').fill('Z901');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByRole('cell', { name: 'Z901' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Z900' })).toHaveCount(0);

    await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Z901' }) }).getByRole('button', { name: 'Delete record' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete record' });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByRole('cell', { name: 'Z901' })).toHaveCount(0);
    await expect(page.getByText('3 records')).toBeVisible();
  });
});
