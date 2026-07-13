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

  test('open a channel in the editor from the dashboard', async ({ page }) => {
    await page.goto('/');
    // Channel names are clickable buttons in the grouped table.
    await page.getByRole('button', { name: /^Example:/ }).first().click();
    await expect(page).toHaveURL(/\/channels\//);
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

  test('configurable columns: toggle the Source column', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('menuitem', { name: 'Source' }).click();
    // Header now includes a Source column.
    await expect(page.getByRole('columnheader', { name: 'Source' })).toBeVisible();
  });
});
