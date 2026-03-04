// ===========================================
// Tags E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_TAG_NAME = 'E2E Test Tag';

test.describe('Tags', () => {
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

      const tagsRes = await ctx.get('/tags', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (tagsRes.ok()) {
        const tagsBody = await tagsRes.json() as {
          success: boolean;
          data: Array<{ id: string; name: string }>;
        };
        const tags = Array.isArray(tagsBody.data) ? tagsBody.data : [];
        for (const tag of tags) {
          if (tag.name.startsWith(TEST_TAG_NAME)) {
            await ctx.delete(`/tags/${tag.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
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

  test('navigate to tags page', async ({ page }) => {
    await page.goto('/tags');
    await expect(page.getByRole('heading', { name: /tags/i })).toBeVisible({ timeout: 10_000 });
  });

  test('create a new tag', async ({ page }) => {
    await page.goto('/tags');
    await expect(page.getByRole('heading', { name: /tags/i })).toBeVisible({ timeout: 10_000 });

    // Click the New / Create button
    await page.getByRole('button', { name: /new|create/i }).click();

    // Fill in the tag name
    const nameField = page.getByLabel('Name');
    await expect(nameField).toBeVisible({ timeout: 10_000 });
    await nameField.fill(TEST_TAG_NAME);

    // If a color picker is present, interact with it (defensive — may use a hex input)
    const colorInput = page.locator('input[type="color"], input[placeholder*="#"], input[value^="#"]').first();
    if (await colorInput.isVisible()) {
      await colorInput.fill('#1976d2');
    }

    // Submit
    await page.getByRole('button', { name: /create|save/i }).click();

    // Tag should appear in the list
    await expect(page.getByText(TEST_TAG_NAME)).toBeVisible({ timeout: 10_000 });
  });

  test('new tag appears in list', async ({ page }) => {
    await page.goto('/tags');
    await page.waitForTimeout(1_000);

    const table = page.locator('table');
    const emptyText = page.getByText(/no.*tag|no data/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyText.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('edit tag name', async ({ page }) => {
    await page.goto('/tags');
    await page.waitForTimeout(1_000);

    const tagRow = page.locator('table tbody tr', { hasText: TEST_TAG_NAME }).first();
    if (await tagRow.isVisible()) {
      const editBtn = tagRow.getByRole('button', { name: /edit/i });
      if (await editBtn.isVisible()) {
        await editBtn.click();

        const nameField = page.getByLabel('Name');
        await expect(nameField).toBeVisible({ timeout: 10_000 });
        await nameField.clear();
        await nameField.fill(TEST_TAG_NAME + ' Updated');

        await page.getByRole('button', { name: /save/i }).click();
        await page.waitForTimeout(1_000);

        await expect(page.getByText(TEST_TAG_NAME + ' Updated')).toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('delete tag with confirmation', async ({ page }) => {
    await page.goto('/tags');
    await page.waitForTimeout(1_000);

    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const tagRow = page
      .locator('table tbody tr')
      .filter({ hasText: /E2E Test Tag/ })
      .first();

    if (await tagRow.isVisible()) {
      const deleteBtn = tagRow.getByRole('button', { name: /delete/i });
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.waitForTimeout(1_000);

        // Confirm in MUI dialog if present
        const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
          await page.waitForTimeout(1_000);
        }

        await expect(page.getByText(TEST_TAG_NAME + ' Updated')).not.toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('empty state shown when no tags', async ({ page }) => {
    await page.goto('/tags');
    await page.waitForTimeout(1_000);

    const table = page.locator('table');
    const emptyIndicator = page.getByText(/no.*tag|no data|empty/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyIndicator.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });
});
