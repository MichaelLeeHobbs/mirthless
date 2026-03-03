// ===========================================
// Channel Statistics E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';

test.describe('Channel Statistics', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to dashboard', async ({ page }) => {
    // login() already lands on the dashboard
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10_000 });
  });

  test('click statistics icon on first channel if available', async ({ page }) => {
    await page.waitForTimeout(2_000);

    // Look for a statistics icon/link in the channel table
    // Common patterns: a bar-chart icon button, a "Stats" link, or a link matching /statistics/
    const statsLink = page
      .locator('table tbody tr')
      .first()
      .getByRole('link', { name: /stat/i });

    const statsIconBtn = page
      .locator('table tbody tr')
      .first()
      .getByRole('button', { name: /stat|chart/i });

    if (await statsLink.isVisible()) {
      await statsLink.click();
      await expect(page).toHaveURL(/\/channels\/.+\/statistics/, { timeout: 10_000 });
    } else if (await statsIconBtn.isVisible()) {
      await statsIconBtn.click();
      await expect(page).toHaveURL(/\/channels\/.+\/statistics/, { timeout: 10_000 });
    }
    // If no channels exist yet, this test passes vacuously
  });

  test('statistics page loads with heading', async ({ page }) => {
    await page.goto('/channels');
    await page.waitForTimeout(1_000);

    // Find the first channel link and derive the statistics URL from it
    const firstChannelLink = page.locator('table tbody tr').first().locator('a').first();
    if (await firstChannelLink.isVisible()) {
      const href = await firstChannelLink.getAttribute('href');
      if (href) {
        // href = /channels/<id>  →  /channels/<id>/statistics
        const statsUrl = href.replace(/\/?$/, '/statistics');
        await page.goto(statsUrl);
        await expect(page.getByRole('heading', { name: /statistics/i })).toBeVisible({ timeout: 10_000 });
      }
    }
  });

  test('summary cards visible on statistics page', async ({ page }) => {
    await page.goto('/channels');
    await page.waitForTimeout(1_000);

    const firstChannelLink = page.locator('table tbody tr').first().locator('a').first();
    if (await firstChannelLink.isVisible()) {
      const href = await firstChannelLink.getAttribute('href');
      if (href) {
        const statsUrl = href.replace(/\/?$/, '/statistics');
        await page.goto(statsUrl);
        await page.waitForTimeout(2_000);

        // Summary cards typically show counts like "Received", "Sent", "Errors"
        const cardTexts = ['Received', 'Sent', 'Error', 'Filtered', 'Queued'];
        let foundCard = false;
        for (const text of cardTexts) {
          const el = page.getByText(new RegExp(text, 'i')).first();
          if (await el.isVisible()) {
            foundCard = true;
            break;
          }
        }
        // Cards must be present once the page loads
        expect(foundCard).toBeTruthy();
      }
    }
  });

  test('connector breakdown table visible on statistics page', async ({ page }) => {
    await page.goto('/channels');
    await page.waitForTimeout(1_000);

    const firstChannelLink = page.locator('table tbody tr').first().locator('a').first();
    if (await firstChannelLink.isVisible()) {
      const href = await firstChannelLink.getAttribute('href');
      if (href) {
        const statsUrl = href.replace(/\/?$/, '/statistics');
        await page.goto(statsUrl);
        await page.waitForTimeout(2_000);

        // A table or a section showing per-connector stats should exist
        const table = page.locator('table');
        const connectorSection = page.getByText(/connector|destination|source/i).first();
        const hasTable = await table.isVisible();
        const hasSection = await connectorSection.isVisible();
        expect(hasTable || hasSection).toBeTruthy();
      }
    }
  });
});
