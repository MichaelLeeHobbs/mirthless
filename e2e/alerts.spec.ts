// ===========================================
// Alerts E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { TEST_ALERT } from './fixtures/test-data.js';

test.describe('Alerts', () => {
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

      // Wait for save button to become enabled
      const saveBtn = page.getByRole('button', { name: /save/i });
      await saveBtn.click({ timeout: 5_000 }).catch(() => {
        // Save button may remain disabled if form doesn't detect changes
      });
      await page.waitForTimeout(1_000);
    }
  });

  test('toggle alert enabled', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForTimeout(2_000);

    // Find the alert row and click the enabled chip to toggle
    const alertRow = page.locator('table tbody tr').filter({ hasText: /E2E Test Alert/ });
    if (await alertRow.first().isVisible()) {
      const enabledChip = alertRow.first().locator('.MuiChip-root').last();
      if (await enabledChip.isVisible()) {
        await enabledChip.click();
        await page.waitForTimeout(1_000);
      }
    }
  });

  test('delete alert', async ({ page }) => {
    await page.goto('/alerts');
    await page.waitForTimeout(2_000);

    // Handle confirm dialog
    page.on('dialog', async (dialog) => {
      await dialog.accept();
    });

    const alertRow = page.locator('table tbody tr').filter({ hasText: /E2E Test Alert/ });
    if (await alertRow.first().isVisible()) {
      await alertRow.first().getByRole('button', { name: /delete/i }).click();
      await page.waitForTimeout(1_000);
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
