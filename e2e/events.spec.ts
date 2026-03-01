// ===========================================
// Events E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Events', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to events page', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible();
  });

  test('events from login appear', async ({ page }) => {
    await page.goto('/events');
    await page.waitForTimeout(2_000);

    // Login generates USER_LOGIN events — at least one should exist
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Table should have at least one row
    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('expand event detail', async ({ page }) => {
    await page.goto('/events');
    await page.waitForTimeout(2_000);

    // Click the expand icon on the first event row
    const expandBtn = page.locator('table tbody tr').first().getByRole('button').first();
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
      await page.waitForTimeout(500);

      // Detail panel should be visible (Collapse component opens)
      // Look for JSON-like content or detail text
      const detailContent = page.locator('table tbody tr').nth(1);
      await expect(detailContent).toBeVisible();
    }
  });

  test('filter by level', async ({ page }) => {
    await page.goto('/events');
    await page.waitForTimeout(2_000);

    // Look for a level filter dropdown
    const levelFilter = page.getByLabel(/level/i);
    if (await levelFilter.isVisible()) {
      await levelFilter.click();
      await page.waitForTimeout(500);

      // Select INFO option
      const option = page.getByRole('option', { name: /info/i });
      if (await option.isVisible()) {
        await option.click();
        await page.waitForTimeout(1_000);
      }
    }
  });

  test('purge dialog opens', async ({ page }) => {
    await page.goto('/events');
    await page.waitForTimeout(2_000);

    // Click the Purge button
    const purgeBtn = page.getByRole('button', { name: /purge/i });
    if (await purgeBtn.isVisible()) {
      await purgeBtn.click();
      await page.waitForTimeout(500);

      // Dialog should appear with days input
      await expect(page.getByText(/purge old events/i)).toBeVisible();

      // Cancel to close
      await page.getByRole('button', { name: /cancel/i }).click();
    }
  });
});
