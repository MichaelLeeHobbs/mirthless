// db:seed creates the admin with mustChangePassword=true and the server refuses every other call
// until it changes, so complete the change once, re-setting the same password.
//
// Through the real login page, so a first login is checked to get past the forced dialog.
//
// CI only: locally Playwright may reuse a developer's server, and clearing the flag there
// would leave a real admin on the public default password.

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
    const baseURL = config.projects[0]?.use.baseURL;
    const page = await browser.newPage(baseURL !== undefined ? { baseURL } : {});
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
