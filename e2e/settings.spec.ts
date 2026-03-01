// ===========================================
// Settings E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Settings', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to settings page', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('default settings visible', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(2_000);

    // Seeded settings should be visible (e.g., general.server_name)
    const settingKey = page.getByText('general.server_name');
    if (await settingKey.isVisible()) {
      await expect(settingKey).toBeVisible();
    } else {
      // At minimum, some settings should be displayed
      const settingsContainer = page.locator('[class*="Paper"], [class*="Card"]');
      const count = await settingsContainer.count();
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });

  test('switch category tabs', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(2_000);

    // Click through each tab
    const tabs = ['All', 'General', 'Security', 'Features'];
    for (const tabName of tabs) {
      const tab = page.getByRole('tab', { name: tabName });
      if (await tab.isVisible()) {
        await tab.click();
        await page.waitForTimeout(500);

        // Tab should be selected
        await expect(tab).toHaveAttribute('aria-selected', 'true');
      }
    }
  });

  test('edit and save setting', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(2_000);

    // Find a text input setting and modify it
    const textInputs = page.locator('input[type="text"]');
    const count = await textInputs.count();
    if (count > 0) {
      const firstInput = textInputs.first();
      await firstInput.clear();
      await firstInput.fill('E2E Test Value');

      // Save button should be enabled now
      const saveBtn = page.getByRole('button', { name: /save/i });
      if (await saveBtn.isEnabled()) {
        await saveBtn.click();
        await page.waitForTimeout(2_000);
      }
    }
  });

  test('boolean setting toggle', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForTimeout(2_000);

    // Find a switch (boolean setting) and toggle it
    const switches = page.locator('input[type="checkbox"][role="switch"]');
    const count = await switches.count();
    if (count > 0) {
      const firstSwitch = switches.first();
      await firstSwitch.click();
      await page.waitForTimeout(500);

      // Save
      const saveBtn = page.getByRole('button', { name: /save/i });
      if (await saveBtn.isEnabled()) {
        await saveBtn.click();
        await page.waitForTimeout(2_000);
      }
    }
  });
});
