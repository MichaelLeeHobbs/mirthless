// ===========================================
// Scenario suite global setup
// ===========================================
// db:seed creates the admin with mustChangePassword=true and the server refuses
// other calls until it changes. The scenario database is a throwaway *_test
// database, so re-set the same password through the API once.

import { request } from '@playwright/test';
import { ADMIN, API_BASE } from './api.js';

export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext();
  try {
    const login = await ctx.post(`${API_BASE}/auth/login`, { data: ADMIN });
    if (!login.ok()) throw new Error(`admin login failed: ${String(login.status())} ${await login.text()}`);
    const body = await login.json() as { data: { accessToken: string; user: { mustChangePassword: boolean } } };
    if (!body.data.user.mustChangePassword) return;
    const res = await ctx.post(`${API_BASE}/users/me/password`, {
      headers: { Authorization: `Bearer ${body.data.accessToken}` },
      data: { currentPassword: ADMIN.password, newPassword: ADMIN.password },
    });
    if (!res.ok()) throw new Error(`password change failed: ${String(res.status())} ${await res.text()}`);
  } finally {
    await ctx.dispose();
  }
}
