// ===========================================
// Collections E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_COLLECTION_NAME = 'E2E Test Collection';

test.describe('Collections', () => {
  // Clean up stale test data from previous runs.
  test.beforeAll(async () => {
    // Full URLs: a leading-slash path would drop the /api/v1 part of a baseURL,
    // which made this cleanup a silent no-op.
    const ctx = await request.newContext();
    try {
      const loginRes = await ctx.post(`${API_BASE}/auth/login`, {
        data: { username: ADMIN_USER.username, password: ADMIN_USER.password },
      });
      if (!loginRes.ok()) return;
      const loginBody = await loginRes.json() as { success: boolean; data: { accessToken: string } };
      if (!loginBody.data?.accessToken) return;
      const token = loginBody.data.accessToken;

      const listRes = await ctx.get(`${API_BASE}/collections`, { headers: { Authorization: `Bearer ${token}` } });
      if (listRes.ok()) {
        const body = await listRes.json() as { data: Array<{ id: string; name: string }> };
        const items = Array.isArray(body.data) ? body.data : [];
        for (const c of items) {
          if (c.name.startsWith(TEST_COLLECTION_NAME)) {
            await ctx.delete(`${API_BASE}/collections/${c.id}`, { headers: { Authorization: `Bearer ${token}` } });
          }
        }
      }
    } finally {
      await ctx.dispose();
    }
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to collections page', async ({ page }) => {
    await page.goto('/collections');
    await expect(page.getByRole('heading', { name: /collections/i })).toBeVisible({ timeout: 10_000 });
  });

  test('create a collection with indexed fields and a TTL', async ({ page }) => {
    await page.goto('/collections');
    await page.getByRole('button', { name: /create collection/i }).click();

    await page.getByLabel('Name').fill(TEST_COLLECTION_NAME);
    await page.getByLabel('Indexed Fields').fill('accessionNumber, institutionName, orderControl');
    await page.getByLabel(/Default TTL/i).fill('604800');
    await page.getByRole('button', { name: /^create$/i }).click();

    // Appears in the list; TTL renders as 7d.
    await expect(page.getByText(TEST_COLLECTION_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('7d').first()).toBeVisible();
  });

  test('create is disabled without indexed fields', async ({ page }) => {
    await page.goto('/collections');
    await page.getByRole('button', { name: /create collection/i }).click();
    await page.getByLabel('Name').fill('E2E Test Collection NoFields');
    // No indexed fields entered → the Create button stays disabled.
    await expect(page.getByRole('button', { name: /^create$/i })).toBeDisabled();
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
    await page.waitForTimeout(1_000);
    const row = page.locator('table tbody tr').filter({ hasText: TEST_COLLECTION_NAME }).first();
    if (await row.isVisible()) {
      await row.getByRole('button', { name: /delete collection/i }).click();
      const confirmBtn = page.getByRole('button', { name: /^delete$/i });
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await page.waitForTimeout(1_000);
      }
      await expect(page.getByText(TEST_COLLECTION_NAME)).not.toBeVisible({ timeout: 10_000 });
    }
  });
});

// ----- Records grid -----

const GRID_COLLECTION_NAME = 'E2E Test Collection Records';

test.describe('Collection records grid', () => {
  let collectionId = '';

  // A fresh collection with three records, made through the API.
  test.beforeAll(async () => {
    // Full URLs: a leading-slash path would drop the /api/v1 part of a baseURL.
    const ctx = await request.newContext();
    try {
      const loginRes = await ctx.post(`${API_BASE}/auth/login`, { data: { username: ADMIN_USER.username, password: ADMIN_USER.password } });
      const token = (await loginRes.json() as { data: { accessToken: string } }).data.accessToken;
      const headers = { Authorization: `Bearer ${token}` };
      const list = await ctx.get(`${API_BASE}/collections`, { headers });
      for (const c of (await list.json() as { data: Array<{ id: string; name: string }> }).data) {
        if (c.name === GRID_COLLECTION_NAME) await ctx.delete(`${API_BASE}/collections/${c.id}`, { headers });
      }
      const created = await ctx.post(`${API_BASE}/collections`, { headers, data: { name: GRID_COLLECTION_NAME, indexedFields: ['accession', 'facility'] } });
      collectionId = (await created.json() as { data: { id: string } }).data.id;
      for (const [accession, facility, payload] of [['B200', 'North', 'second'], ['A100', 'South', 'first'], ['C300', 'North', 'third']]) {
        await ctx.post(`${API_BASE}/collections/${collectionId}/records`, { headers, data: { fields: { accession, facility }, payload } });
      }
    } finally {
      await ctx.dispose();
    }
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.goto(`/collections/${collectionId}/records`);
    await expect(page.getByRole('heading', { name: GRID_COLLECTION_NAME })).toBeVisible({ timeout: 10_000 });
  });

  const accessions = (page: import('@playwright/test').Page): Promise<string[]> =>
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
    await page.getByRole('textbox', { name: 'Search records' }).fill('nothing-like-this');
    await expect(page.getByText('No matching records')).toBeVisible();
  });

  test('adds, edits and deletes a record', async ({ page }) => {
    await page.getByRole('button', { name: 'Add Record' }).click();
    const add = page.getByRole('dialog', { name: 'Add record' });
    await add.getByLabel('accession').fill('Z900');
    await add.getByLabel('Payload').fill('added from e2e');
    await add.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByRole('cell', { name: 'Z900' })).toBeVisible();

    await page.getByRole('cell', { name: 'Z900' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit record' });
    await edit.getByLabel('accession').fill('Z901');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: 'Z901' })).toBeVisible();

    await page.locator('table tbody tr', { hasText: 'Z901' }).getByRole('button', { name: 'Delete record' }).click();
    await page.getByRole('button', { name: /^delete$/i }).click();
    await expect(page.getByRole('cell', { name: 'Z901' })).not.toBeVisible();
    await expect(page.getByText('3 records')).toBeVisible();
  });
});
