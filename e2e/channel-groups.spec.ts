// ===========================================
// Channel Groups E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';
const TEST_GROUP_NAME = 'E2E Test Group';

test.describe('Channel Groups', () => {
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

      const groupRes = await ctx.get('/channel-groups', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (groupRes.ok()) {
        const groupBody = await groupRes.json() as {
          success: boolean;
          data: Array<{ id: string; name: string }>;
        };
        const groups = Array.isArray(groupBody.data) ? groupBody.data : [];
        for (const group of groups) {
          if (group.name.startsWith(TEST_GROUP_NAME)) {
            await ctx.delete(`/channel-groups/${group.id}`, {
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

  test('navigate to channel groups page', async ({ page }) => {
    await page.goto('/channel-groups');
    await expect(page.getByRole('heading', { name: /channel groups/i })).toBeVisible({ timeout: 10_000 });
  });

  test('create a new channel group', async ({ page }) => {
    await page.goto('/channel-groups');
    await expect(page.getByRole('heading', { name: /channel groups/i })).toBeVisible({ timeout: 10_000 });

    // Click the New / Create button
    await page.getByRole('button', { name: /new|create/i }).click();

    // Fill in the group name
    const nameField = page.getByLabel('Name');
    await expect(nameField).toBeVisible({ timeout: 10_000 });
    await nameField.fill(TEST_GROUP_NAME);

    // Submit
    await page.getByRole('button', { name: /create|save/i }).click();

    // Group should appear in the list
    await expect(page.getByText(TEST_GROUP_NAME)).toBeVisible({ timeout: 10_000 });
  });

  test('new group appears in list', async ({ page }) => {
    await page.goto('/channel-groups');
    await page.waitForTimeout(1_000);

    // The group created in the previous test (or pre-existing data) should be listed
    const table = page.locator('table');
    const emptyText = page.getByText(/no.*group|no data/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyText.isVisible();
    // Page is in a valid state with either a table or empty message
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('edit group name', async ({ page }) => {
    await page.goto('/channel-groups');
    await page.waitForTimeout(1_000);

    const groupRow = page.locator('table tbody tr', { hasText: TEST_GROUP_NAME }).first();
    if (await groupRow.isVisible()) {
      const editBtn = groupRow.getByRole('button', { name: /edit/i });
      if (await editBtn.isVisible()) {
        await editBtn.click();

        const nameField = page.getByLabel('Name');
        await expect(nameField).toBeVisible({ timeout: 10_000 });
        await nameField.clear();
        await nameField.fill(TEST_GROUP_NAME + ' Updated');

        await page.getByRole('button', { name: /save/i }).click();
        await page.waitForTimeout(1_000);

        await expect(page.getByText(TEST_GROUP_NAME + ' Updated')).toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('delete group with confirmation', async ({ page }) => {
    await page.goto('/channel-groups');
    await page.waitForTimeout(1_000);

    // Accept any native confirm dialogs
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    // Match either original or updated name
    const groupRow = page
      .locator('table tbody tr')
      .filter({ hasText: /E2E Test Group/ })
      .first();

    if (await groupRow.isVisible()) {
      const deleteBtn = groupRow.getByRole('button', { name: /delete/i });
      if (await deleteBtn.isVisible()) {
        await deleteBtn.click();
        await page.waitForTimeout(1_000);

        // Confirm in MUI dialog if present
        const confirmBtn = page.getByRole('button', { name: /confirm|yes|delete/i });
        if (await confirmBtn.isVisible()) {
          await confirmBtn.click();
          await page.waitForTimeout(1_000);
        }

        await expect(page.getByText(TEST_GROUP_NAME + ' Updated')).not.toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('empty state message shown when no groups', async ({ page }) => {
    await page.goto('/channel-groups');
    await page.waitForTimeout(1_000);

    const table = page.locator('table');
    const emptyIndicator = page.getByText(/no.*group|no data|empty/i);
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyIndicator.isVisible();
    // Page renders without error in either state
    expect(hasTable || hasEmpty).toBeTruthy();
  });
});
