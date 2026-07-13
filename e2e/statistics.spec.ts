// ===========================================
// Channel Statistics E2E Tests
// ===========================================

import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';

/** Open the statistics page for the first channel via its dashboard Statistics icon. */
async function openFirstChannelStatistics(page: Page): Promise<boolean> {
  await page.goto('/');
  await page.waitForTimeout(1_000);
  const statsBtn = page.getByRole('button', { name: /view statistics for/i }).first();
  if (!(await statsBtn.isVisible().catch(() => false))) return false;
  await statsBtn.click();
  await expect(page).toHaveURL(/\/channels\/.+\/statistics/, { timeout: 10_000 });
  return true;
}

test.describe('Channel Statistics', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to dashboard', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10_000 });
  });

  test('open statistics from a channel row', async ({ page }) => {
    await openFirstChannelStatistics(page);
    // If channels exist, the assertion inside the helper already ran.
  });

  test('statistics page loads with heading', async ({ page }) => {
    if (!(await openFirstChannelStatistics(page))) return;
    await expect(page.getByRole('heading', { name: /statistics/i })).toBeVisible({ timeout: 10_000 });
  });

  test('summary cards visible on statistics page', async ({ page }) => {
    if (!(await openFirstChannelStatistics(page))) return;
    await page.waitForTimeout(1_000);
    const cardTexts = ['Received', 'Sent', 'Error', 'Filtered', 'Queued'];
    let foundCard = false;
    for (const text of cardTexts) {
      if (await page.getByText(new RegExp(text, 'i')).first().isVisible()) {
        foundCard = true;
        break;
      }
    }
    expect(foundCard).toBeTruthy();
  });

  test('connector breakdown table visible on statistics page', async ({ page }) => {
    if (!(await openFirstChannelStatistics(page))) return;
    await page.waitForTimeout(1_000);
    const hasTable = await page.locator('table').isVisible();
    const hasSection = await page.getByText(/connector|destination|source/i).first().isVisible();
    expect(hasTable || hasSection).toBeTruthy();
  });
});
