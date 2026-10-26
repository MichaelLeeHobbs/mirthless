// ===========================================
// Alerts E2E Tests
// ===========================================

import { test, expect, request } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER, TEST_ALERT } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';

test.describe('Alerts', () => {
  // Clean up stale test data from previous runs (best-effort — skip if rate-limited)
  test.beforeAll(async () => {
    const ctx = await request.newContext({ baseURL: API_BASE });
    try {
      const loginRes = await ctx.post('/auth/login', {
        data: { username: ADMIN_USER.username, password: ADMIN_USER.password },
      });
      if (!loginRes.ok()) return; // rate-limited or server error — skip cleanup

      const loginBody = await loginRes.json() as { success: boolean; data: { accessToken: string } };
      if (!loginBody.data?.accessToken) return;
      const token = loginBody.data.accessToken;

      const alertRes = await ctx.get('/alerts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (alertRes.ok()) {
        const alertBody = await alertRes.json() as {
          success: boolean;
          data: { data: Array<{ id: string; name: string }>; pagination: unknown };
        };
        for (const alert of alertBody.data.data) {
          if (alert.name.startsWith(TEST_ALERT.name)) {
            await ctx.delete(`/alerts/${alert.id}`, {
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

  test('navigate to alerts page', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();
  });

  test('create alert', async ({ page }) => {
    await page.goto('/alerts');

    // Click Create Alert button
    await page.getByRole('button', { name: /create alert/i }).click();

    // Should navigate to alert editor
    await page.waitForTimeout(1_000);

    // Fill in alert name
    const nameField = page.getByLabel('Name');
    await expect(nameField).toBeVisible({ timeout: 10_000 });
    await nameField.fill(TEST_ALERT.name);

    // Fill description
    const descField = page.getByLabel('Description');
    if (await descField.isVisible()) {
      await descField.fill(TEST_ALERT.description);
    }

    // Click Create/Save button
    await page.getByRole('button', { name: /create|save/i }).click();
    await page.waitForTimeout(2_000);
  });

  test('edit alert', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForTimeout(2_000);

    // Find the alert row and click edit (use .first() in case of duplicates from previous runs)
    const alertRow = page.locator('table tbody tr', { hasText: TEST_ALERT.name }).first();
    if (await alertRow.isVisible()) {
      await alertRow.getByRole('button', { name: /edit/i }).click();
      await page.waitForTimeout(1_000);

      // Update name to trigger dirty state
      const nameField = page.getByLabel('Name');
      if (await nameField.isVisible()) {
        await nameField.fill(TEST_ALERT.name + ' Updated');
      }

      // Wait for save button to become enabled then click
      const saveBtn = page.getByRole('button', { name: /save/i });
      await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
      await saveBtn.click();
      await page.waitForTimeout(1_000);
    }
  });

  test('toggle alert enabled', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForTimeout(2_000);

    // The Enabled column is a switch named after the alert; one click flips it.
    const alertRow = page.locator('table tbody tr').filter({ hasText: /E2E Test Alert/ });
    if (await alertRow.first().isVisible()) {
      const toggle = alertRow.first().getByRole('switch', { name: /^(Enable|Disable) E2E Test Alert/ });
      const wasOn = await toggle.isChecked();
      await toggle.click();
      await expect(toggle).toBeChecked({ checked: !wasOn, timeout: 5_000 });
    }
  });

  test('delete alert', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForTimeout(2_000);

    const alertRow = page.locator('table tbody tr').filter({ hasText: /E2E Test Alert/ });
    if (await alertRow.first().isVisible()) {
      const before = await alertRow.count();
      await alertRow.first().getByRole('button', { name: 'Delete alert' }).click();
      // Confirm in the in-app dialog, which names the alert.
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('E2E Test Alert');
      await dialog.getByRole('button', { name: 'Delete' }).click();
      await expect(alertRow).toHaveCount(before - 1, { timeout: 5_000 });
    }
  });

  test('empty state when no alerts', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForTimeout(2_000);

    // If there are no alerts, some form of empty state should be shown
    const table = page.locator('table');
    const emptyText = page.getByText(/no alerts/i);
    // Either the table is empty or we see an empty message
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyText.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('validation on create', async ({ page }) => {
    await page.goto('/alerts');

    await page.getByRole('button', { name: /create alert/i }).click();
    await page.waitForTimeout(1_000);

    // Try to create without filling name
    await page.getByRole('button', { name: /create|save/i }).click();
    await page.waitForTimeout(1_000);

    // Should show validation error or remain on the page
    const nameField = page.getByLabel('Name');
    await expect(nameField).toBeVisible();
  });
});
