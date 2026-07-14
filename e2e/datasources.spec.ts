// ===========================================
// Data Sources E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_DS_NAME = 'E2E Test DataSource';

test.describe('Data Sources', () => {
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

      const listRes = await ctx.get('/datasources', { headers: { Authorization: `Bearer ${token}` } });
      if (listRes.ok()) {
        const body = await listRes.json() as { data: Array<{ id: string; name: string }> };
        const items = Array.isArray(body.data) ? body.data : [];
        for (const d of items) {
          if (d.name.startsWith(TEST_DS_NAME)) {
            await ctx.delete(`/datasources/${d.id}`, { headers: { Authorization: `Bearer ${token}` } });
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

  test('navigate to data sources page', async ({ page }) => {
    await page.goto('/datasources');
    await expect(page.getByRole('heading', { name: /data sources/i })).toBeVisible({ timeout: 10_000 });
  });

  test('create a read-only data source', async ({ page }) => {
    await page.goto('/datasources');
    await page.getByRole('button', { name: /create data source/i }).click();

    await page.getByLabel('Name').fill(TEST_DS_NAME);
    await page.getByLabel('Host').fill('localhost');
    await page.getByLabel('Database').fill('mirthless');
    await page.getByLabel('User').fill('mirthless');
    await page.getByLabel('Password', { exact: false }).fill('mirthless_dev');
    await page.getByRole('button', { name: /^create$/i }).click();

    await expect(page.getByText(TEST_DS_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Read-only').first()).toBeVisible();
  });

  test('password field is never pre-filled on edit', async ({ page }) => {
    await page.goto('/datasources');
    await page.waitForTimeout(1_000);
    const row = page.locator('table tbody tr', { hasText: TEST_DS_NAME }).first();
    if (await row.isVisible()) {
      await row.getByRole('button', { name: /edit data source/i }).click();
      const pw = page.getByLabel('Password', { exact: false });
      await expect(pw).toBeVisible();
      await expect(pw).toHaveValue('');
    }
  });

  test('create stays disabled until required fields are filled', async ({ page }) => {
    await page.goto('/datasources');
    await page.getByRole('button', { name: /create data source/i }).click();
    await page.getByLabel('Name').fill('E2E Test DataSource Incomplete');
    // Host/database/user/password still empty → Create disabled.
    await expect(page.getByRole('button', { name: /^create$/i })).toBeDisabled();
  });

  test('delete a data source with confirmation', async ({ page }) => {
    await page.goto('/datasources');
    await page.waitForTimeout(1_000);
    const row = page.locator('table tbody tr').filter({ hasText: TEST_DS_NAME }).first();
    if (await row.isVisible()) {
      await row.getByRole('button', { name: /delete data source/i }).click();
      const confirmBtn = page.getByRole('button', { name: /^delete$/i });
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await page.waitForTimeout(1_000);
      }
      await expect(page.getByText(TEST_DS_NAME)).not.toBeVisible({ timeout: 10_000 });
    }
  });
});
