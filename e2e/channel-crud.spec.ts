// ===========================================
// Channel CRUD E2E Tests (via the Dashboard)
// ===========================================
// The standalone Channels view was retired — all channel authoring now happens
// from the Dashboard (header actions + right-click context menu).

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Channel CRUD (Dashboard)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard loads and /channels redirects to it', async ({ page }) => {
    await page.goto('/channels');
    await expect(page).toHaveURL(/\/$|\/#?$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('create channel via the New Channel dialog', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New Channel' }).click();

    await page.getByLabel('Name').fill('E2E CRUD Channel');
    const desc = page.getByLabel('Description');
    if (await desc.isVisible().catch(() => false)) {
      await desc.fill('Created by E2E test');
    }
    await page.getByRole('button', { name: /create|save/i }).click();

    // Lands in the editor or shows in the dashboard table.
    await expect(page.getByText('E2E CRUD Channel')).toBeVisible({ timeout: 10_000 });
  });

  test('empty name fails validation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New Channel' }).click();
    await page.getByRole('button', { name: /create|save/i }).click();
    // Dialog stays open with the Name field still visible.
    await expect(page.getByLabel('Name')).toBeVisible();
  });

  test('channel name navigates to the message browser (not the editor)', async ({ page }) => {
    await page.goto('/');
    // Channel names are clickable buttons; clicking one opens that channel's messages.
    await page.getByRole('button', { name: /^Example:/ }).first().click();
    await expect(page).toHaveURL(/\/channels\/[^/]+\/messages/);
  });

  test('Edit from the context menu opens the editor', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('tr', { hasText: 'Example: Echo (RAW)' }).first();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/channels\/[^/]+$/);
  });

  test('context menu no longer offers Statistics', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('tr', { hasText: 'Example: Echo (RAW)' }).first();
    await row.click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Messages' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Statistics' })).toHaveCount(0);
  });

  test('enable/disable from the context menu', async ({ page }) => {
    await page.goto('/');
    const row = page.locator('tr', { hasText: 'Example: Echo (RAW)' }).first();
    await row.click({ button: 'right' });
    // The menu offers Enable or Disable depending on current state.
    const toggle = page.getByRole('menuitem').filter({ hasText: /^(Enable|Disable)$/ });
    await expect(toggle).toBeVisible();
    await toggle.click();
  });

  test('delete a channel via the context menu + confirm dialog', async ({ page }) => {
    await page.goto('/');
    // Create a throwaway channel to delete.
    await page.getByRole('button', { name: 'New Channel' }).click();
    await page.getByLabel('Name').fill('E2E Delete Channel');
    await page.getByRole('button', { name: /create|save/i }).click();
    await page.goto('/');
    await expect(page.getByText('E2E Delete Channel')).toBeVisible({ timeout: 10_000 });

    const row = page.locator('tr', { hasText: 'E2E Delete Channel' }).first();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    // MUI confirm dialog (not a native dialog).
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('E2E Delete Channel')).not.toBeVisible({ timeout: 10_000 });
  });

  test('search filters channels in the flat view', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'flat view' }).click();
    const search = page.getByPlaceholder(/search/i);
    await search.fill('nonexistent_channel_xyz');
    await expect(page.getByText('No channels match your search.')).toBeVisible({ timeout: 5_000 });
  });

  test('group header right-click opens the group menu (not the channel menu)', async ({ page }) => {
    await page.goto('/');
    // Grouped view is the default; a non-Ungrouped group header carries the group menu.
    const groupHeader = page.locator('tr', { hasText: /\((\d+)\)$/ })
      .filter({ hasNot: page.getByText('Ungrouped') })
      .first();
    if (!(await groupHeader.isVisible().catch(() => false))) {
      test.skip(true, 'No non-Ungrouped group present to exercise the group menu');
      return;
    }
    await groupHeader.click({ button: 'right' });
    // Group menu exposes bulk lifecycle actions; the channel menu never does.
    await expect(page.getByRole('menuitem', { name: 'Deploy all' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Rename' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
  });

  test('configurable columns: toggle the Source column', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('menuitem', { name: 'Source' }).click();
    // Header now includes a Source column.
    await expect(page.getByRole('columnheader', { name: 'Source' })).toBeVisible();
  });
});
