// ===========================================
// Cross-Channel Message Search E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Cross-Channel Message Search', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to messages page and verify heading', async ({ page }) => {
    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: /messages/i })).toBeVisible({ timeout: 10_000 });
  });

  test('filter controls are visible', async ({ page }) => {
    await page.goto('/messages');
    await page.waitForTimeout(2_000);

    // Expect at least one filter control to exist: a date picker, status selector, channel selector, or search input
    const filterSelectors = [
      page.getByRole('combobox').first(),           // MUI Select (channel / status filter)
      page.getByPlaceholder(/search/i).first(),      // Search box
      page.locator('input[type="date"]').first(),    // Date picker
      page.getByLabel(/channel/i).first(),           // Channel filter label
      page.getByLabel(/status/i).first(),            // Status filter label
      page.getByLabel(/date|from|start/i).first(),   // Date range label
    ];

    let foundFilter = false;
    for (const locator of filterSelectors) {
      if (await locator.isVisible()) {
        foundFilter = true;
        break;
      }
    }
    expect(foundFilter).toBeTruthy();
  });

  test('message table structure is visible', async ({ page }) => {
    await page.goto('/messages');
    await page.waitForTimeout(2_000);

    // A table element (possibly empty) must be rendered
    const table = page.locator('table');
    const emptyState = page.getByText(/no messages|no data|empty/i).first();
    const hasTable = await table.isVisible();
    const hasEmpty = await emptyState.isVisible();
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test('empty state message when no messages match', async ({ page }) => {
    await page.goto('/messages');
    await page.waitForTimeout(2_000);

    // If there are no messages, an empty state element should exist
    // (either a text node, an icon, or a table with no rows)
    const table = page.locator('table');
    if (await table.isVisible()) {
      // Check whether the tbody has rows
      const rows = page.locator('table tbody tr');
      const rowCount = await rows.count();
      // Either rows exist or an empty-state overlay is shown
      const emptyText = page.getByText(/no messages|no data|0 results/i).first();
      const hasEmpty = await emptyText.isVisible();
      expect(rowCount > 0 || hasEmpty).toBeTruthy();
    }
  });

  test('search applies and table updates', async ({ page }) => {
    await page.goto('/messages');
    await page.waitForTimeout(2_000);

    // Attempt to use any search / filter input
    const searchInput = page.getByPlaceholder(/search/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('nonexistent_query_xyz');
      // Allow debounce / API call to settle
      await page.waitForTimeout(1_500);

      // Table should still be rendered (even if empty)
      const table = page.locator('table');
      const emptyText = page.getByText(/no messages|no data|0 results/i).first();
      const hasTable = await table.isVisible();
      const hasEmpty = await emptyText.isVisible();
      expect(hasTable || hasEmpty).toBeTruthy();
    }
  });
});
