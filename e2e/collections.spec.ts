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
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const loginRes = await ctx.post('/auth/login', {
        data: { username: ADMIN_USER.username, password: ADMIN_USER.password },
      });
      if (!loginRes.ok()) return;
      const loginBody = await loginRes.json() as { success: boolean; data: { accessToken: string } };
      if (!loginBody.data?.accessToken) return;
      const token = loginBody.data.accessToken;

      const listRes = await ctx.get('/collections', { headers: { Authorization: `Bearer ${token}` } });
      if (listRes.ok()) {
        const body = await listRes.json() as { data: Array<{ id: string; name: string }> };
        const items = Array.isArray(body.data) ? body.data : [];
        for (const c of items) {
          if (c.name.startsWith(TEST_COLLECTION_NAME)) {
            await ctx.delete(`/collections/${c.id}`, { headers: { Authorization: `Bearer ${token}` } });
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

  test('view records dialog opens', async ({ page }) => {
    await page.goto('/collections');
    await page.waitForTimeout(1_000);
    const row = page.locator('table tbody tr', { hasText: TEST_COLLECTION_NAME }).first();
    if (await row.isVisible()) {
      await row.getByRole('button', { name: /view records/i }).click();
      await expect(page.getByText(/no records stored yet|records —/i).first()).toBeVisible({ timeout: 10_000 });
    }
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
