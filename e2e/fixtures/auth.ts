// ===========================================
// Auth Fixture
// ===========================================
// Login helper for E2E tests. Logs in via the UI login page.

import { type Page } from '@playwright/test';
import { ADMIN_USER } from './test-data.js';

/** Log in via the login page UI. */
export async function login(
  page: Page,
  credentials?: { username: string; password: string },
): Promise<void> {
  const { username, password } = credentials ?? ADMIN_USER;

  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();

  // Wait for redirect to dashboard
  await page.waitForURL('/', { timeout: 10_000 });
}
