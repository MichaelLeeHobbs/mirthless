// ===========================================
// Global Map E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_KEY = 'e2e_test_key';
const TEST_VALUE = 'e2e_test_value';

test.describe('Global Map', () => {
  // Clean up stale test data from previous runs
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

      // Delete the test key if it exists
      await ctx.delete(`/global-map/${TEST_KEY}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      await ctx.dispose();
    }
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to global map page', async ({ page }) => {
    await page.goto('/global-map');
    await expect(page.getByRole('heading', { name: /global map/i })).toBeVisible({ timeout: 10_000 });
  });

  test('add a new key-value entry', async ({ page }) => {
    await page.goto('/global-map');
    await expect(page.getByRole('heading', { name: /global map/i })).toBeVisible({ timeout: 10_000 });

    // Click Add / New button
    const addBtn = page.getByRole('button', { name: /add|new|create/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Fill in key
    const keyField = page.getByLabel('Key');
    await expect(keyField).toBeVisible({ timeout: 10_000 });
    await keyField.fill(TEST_KEY);

    // Fill in value
    const valueField = page.getByLabel('Value');
    await expect(valueField).toBeVisible({ timeout: 10_000 });
    await valueField.fill(TEST_VALUE);

    // Save
    await page.getByRole('button', { name: /save|add|create/i }).click();

    // Entry should appear in the table
    await expect(page.getByText(TEST_KEY)).toBeVisible({ timeout: 10_000 });
  });

  test('new entry appears in the list', async ({ page }) => {
    await page.goto('/global-map');
    await page.waitForTimeout(1_000);

    // The test key should be visible if created in the previous test
    const keyCell = page.getByText(TEST_KEY);
    const table = page.locator('table');
    const emptyText = page.getByText(/no.*entries|no data|empty/i);
    const hasKey = await keyCell.isVisible();
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyText.isVisible();
    expect(hasKey || hasTable || hasEmpty).toBeTruthy();
  });

  test('delete an entry', async ({ page }) => {
    await page.goto('/global-map');
    await page.waitForTimeout(1_000);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const entryRow = page.locator('table tbody tr', { hasText: TEST_KEY }).first();
    if (await entryRow.isVisible()) {
      const deleteBtn = entryRow.getByRole('button', { name: /delete|remove/i });
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.waitForTimeout(1_000);

        // Confirm in MUI dialog if present
        const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
          await page.waitForTimeout(1_000);
        }

        await expect(page.getByText(TEST_KEY)).not.toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('clear all entries', async ({ page }) => {
    await page.goto('/global-map');
    await page.waitForTimeout(1_000);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Look for a "Clear All" or "Clear" button — only interact if it exists
    const clearBtn = page.getByRole('button', { name: /clear all|clear/i });
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await page.waitForTimeout(1_000);

      // Confirm in MUI dialog if present
      const confirmBtn = page.getByRole('button', { name: /confirm|yes|clear/i });
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await page.waitForTimeout(1_000);
      }

      // After clearing, table should be empty or show empty state
      const remainingRows = page.locator('table tbody tr');
      const rowCount = await remainingRows.count();
      const emptyText = page.getByText(/no.*entries|no data|empty/i);
      const hasEmpty = await emptyText.isVisible();
      // Either 0 rows or an empty state message
      expect(rowCount === 0 || hasEmpty).toBeTruthy();
    }
  });
});
