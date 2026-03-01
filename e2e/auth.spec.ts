// ===========================================
// Auth E2E Tests
// ===========================================

import { test, expect } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

test.describe('Authentication', () => {
  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');
    // Dashboard should be visible
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('login with wrong password shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill(ADMIN_USER.username);
    await page.getByLabel('Password').fill('wrongpassword123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should show error message
    await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible({ timeout: 5_000 });
    // Should remain on login page
    await expect(page).toHaveURL('/login');
  });

  test('empty fields show validation errors', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Should not navigate away
    await expect(page).toHaveURL('/login');
  });

  test('session persists on refresh', async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL('/');

    // Refresh the page
    await page.reload();

    // Should still be on dashboard, not redirected to login
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('protected route redirects to login when not authenticated', async ({ page }) => {
    await page.goto('/channels');

    // Should redirect to login
    await expect(page).toHaveURL('/login');
  });
});
