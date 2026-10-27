// ===========================================
// Playwright Global Setup
// ===========================================
// db:seed creates the admin with mustChangePassword=true, and the server
// rejects every other API call until that password is changed. Complete the
// forced change once (re-setting the same password) so the specs can use the
// seeded credentials. Runs after the webServers are up.
//
// The change goes through the real login page and forced dialog, so this also
// checks that a first login can get past it. A user who lands back on the login
// page instead fails the run.
//
// Only in CI, where Playwright always starts its own servers against a
// throwaway database. Locally it may reuse a developer's running server, and
// clearing the flag there would leave a real admin on the public default
// password, so a local run fails loudly instead.

import { chromium, expect, request, type FullConfig } from '@playwright/test';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1/';

async function adminMustChangePassword(): Promise<boolean> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const loginRes = await ctx.post('auth/login', { data: ADMIN_USER });
    if (!loginRes.ok()) {
      throw new Error(`Admin login failed: ${loginRes.status()} ${await loginRes.text()}`);
    }
    const body = await loginRes.json() as { data: { user: { mustChangePassword: boolean } } };
    return body.data.user.mustChangePassword;
  } finally {
    await ctx.dispose();
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!await adminMustChangePassword()) return;
  if (!process.env.CI) {
    throw new Error('The seeded admin must change its password first. E2E only completes that automatically in CI.');
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL: config.projects[0]?.use.baseURL });
    await page.goto('/login');
    await page.getByLabel('Username').fill(ADMIN_USER.username);
    await page.getByLabel('Password').fill(ADMIN_USER.password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    const dialog = page.getByRole('dialog', { name: 'Change Password' });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByLabel('Current Password').fill(ADMIN_USER.password);
    await dialog.getByLabel('New Password', { exact: true }).fill(ADMIN_USER.password);
    await dialog.getByLabel('Confirm New Password').fill(ADMIN_USER.password);
    await dialog.getByRole('button', { name: 'Change Password' }).click();

    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  } finally {
    await browser.close();
  }
}
