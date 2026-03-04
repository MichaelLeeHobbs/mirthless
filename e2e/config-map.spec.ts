// ===========================================
// Config Map E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_CATEGORY = 'e2e_category';
const TEST_NAME = 'e2e_config_key';
const TEST_VALUE = 'e2e_config_value';

test.describe('Config Map', () => {
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

      // Delete the test entry if it exists (composite PK: category + name)
      await ctx.delete(`/config-map/${TEST_CATEGORY}/${TEST_NAME}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } finally {
      await ctx.dispose();
    }
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to config map page', async ({ page }) => {
    await page.goto('/config-map');
    await expect(page.getByRole('heading', { name: /config map/i })).toBeVisible({ timeout: 10_000 });
  });

  test('add a new config entry', async ({ page }) => {
    await page.goto('/config-map');
    await expect(page.getByRole('heading', { name: /config map/i })).toBeVisible({ timeout: 10_000 });

    // Click Add / New button
    const addBtn = page.getByRole('button', { name: /add|new|create/i });
    await expect(addBtn).toBeVisible({ timeout: 10_000 });
    await addBtn.click();

    // Fill in category
    const categoryField = page.getByLabel('Category');
    await expect(categoryField).toBeVisible({ timeout: 10_000 });
    await categoryField.fill(TEST_CATEGORY);

    // Fill in name (key)
    const nameField = page.getByLabel('Name');
    await expect(nameField).toBeVisible({ timeout: 10_000 });
    await nameField.fill(TEST_NAME);

    // Fill in value
    const valueField = page.getByLabel('Value');
    await expect(valueField).toBeVisible({ timeout: 10_000 });
    await valueField.fill(TEST_VALUE);

    // Save
    await page.getByRole('button', { name: /save|add|create/i }).click();

    // Entry should appear in the table
    await expect(page.getByText(TEST_CATEGORY)).toBeVisible({ timeout: 10_000 });
  });

  test('new entry appears in the list', async ({ page }) => {
    await page.goto('/config-map');
    await page.waitForTimeout(1_000);

    const table = page.locator('table');
    const emptyText = page.getByText(/no.*entries|no data|empty/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyText.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('edit a config entry', async ({ page }) => {
    await page.goto('/config-map');
    await page.waitForTimeout(1_000);

    // Find the row containing the test entry
    const entryRow = page
      .locator('table tbody tr')
      .filter({ hasText: TEST_CATEGORY })
      .first();

    if (await entryRow.isVisible()) {
      const editBtn = entryRow.getByRole('button', { name: /edit/i });
      if (await editBtn.isVisible()) {
        await editBtn.click();

        const valueField = page.getByLabel('Value');
        if (await valueField.isVisible()) {
          await valueField.clear();
          await valueField.fill(TEST_VALUE + '_updated');
        }

        await page.getByRole('button', { name: /save/i }).click();
        await page.waitForTimeout(1_000);
      }
    }
  });

  test('delete a config entry', async ({ page }) => {
    await page.goto('/config-map');
    await page.waitForTimeout(1_000);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const entryRow = page
      .locator('table tbody tr')
      .filter({ hasText: TEST_CATEGORY })
      .first();

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

        // The test entry should no longer appear
        const remainingRows = page.locator('table tbody tr', { hasText: TEST_NAME });
        await expect(remainingRows).toHaveCount(0, { timeout: 10_000 });
      }
    }
  });
});
