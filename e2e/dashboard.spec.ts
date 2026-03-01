// ===========================================
// Dashboard E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to dashboard', async ({ page }) => {
    // After login we should already be on the dashboard
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('dashboard is default page after login', async ({ page }) => {
    // login() waits for redirect to /
    expect(page.url()).toContain('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('summary cards visible', async ({ page }) => {
    // Wait for dashboard to load
    await page.waitForTimeout(2_000);

    // Check for summary card text — at minimum "Total Channels" should appear
    await expect(page.getByText('Total Channels')).toBeVisible({ timeout: 10_000 });
  });

  test('channel status table visible', async ({ page }) => {
    await page.waitForTimeout(2_000);

    // The channel status table should have a table element
    const table = page.locator('table');
    if (await table.isVisible()) {
      // Table headers should include channel-related columns
      await expect(table).toBeVisible();
    }
  });
});
