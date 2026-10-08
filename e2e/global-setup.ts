// ===========================================
// Playwright Global Setup
// ===========================================
// db:seed creates the admin with mustChangePassword=true, and the server
// rejects every other API call until that password is changed. Complete the
// forced change once (re-setting the same password) so the specs can use the
// seeded credentials. Runs after the webServers are up.

import { request } from '@playwright/test';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1/';

export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    const loginRes = await ctx.post('auth/login', { data: ADMIN_USER });
    if (!loginRes.ok()) {
      throw new Error(`Admin login failed: ${loginRes.status()} ${await loginRes.text()}`);
    }
    const body = await loginRes.json() as { data: { accessToken: string; user: { mustChangePassword: boolean } } };
    if (!body.data.user.mustChangePassword) return;

    const changeRes = await ctx.post('users/me/password', {
      headers: { Authorization: `Bearer ${body.data.accessToken}` },
      data: { currentPassword: ADMIN_USER.password, newPassword: ADMIN_USER.password },
    });
    if (!changeRes.ok()) {
      throw new Error(`Admin password change failed: ${changeRes.status()} ${await changeRes.text()}`);
    }
  } finally {
    await ctx.dispose();
  }
}
