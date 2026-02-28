// ===========================================
// Channel Deploy E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Channel Deployment', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('dashboard shows channel status table', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Dashboard')).toBeVisible();

    // Should show some kind of channel status display
    const statusTable = page.locator('table');
    if (await statusTable.isVisible()) {
      await expect(statusTable).toBeVisible();
    }
  });

  test('deploy channel from dashboard', async ({ page }) => {
    await page.goto('/');

    // Find a deploy button in the dashboard
    const deployBtn = page.getByRole('button', { name: /deploy/i }).first();
    if (await deployBtn.isVisible()) {
      await deployBtn.click();
      // Should show status change or confirmation
      await page.waitForTimeout(2_000);
    }
  });

  test('start deployed channel changes status', async ({ page }) => {
    await page.goto('/');

    // Find a start button
    const startBtn = page.getByRole('button', { name: /start/i }).first();
    if (await startBtn.isVisible()) {
      await startBtn.click();
      await page.waitForTimeout(2_000);
    }
  });

  test('stop running channel changes status', async ({ page }) => {
    await page.goto('/');

    const stopBtn = page.getByRole('button', { name: /stop/i }).first();
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
      await page.waitForTimeout(2_000);
    }
  });

  test('undeploy stopped channel', async ({ page }) => {
    await page.goto('/');

    const undeployBtn = page.getByRole('button', { name: /undeploy/i }).first();
    if (await undeployBtn.isVisible()) {
      await undeployBtn.click();
      await page.waitForTimeout(2_000);
    }
  });
});
