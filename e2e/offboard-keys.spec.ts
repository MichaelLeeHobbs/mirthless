// Users can't be deleted, so each run uses names of its own (D-289).

import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, postData } from './fixtures/api.js';

const RUN_ID = Date.now().toString(36);
const LEAVER = `e2e-leaver-${RUN_ID}`;
const PASSWORD = 'LeaverKeys123!';

// A fresh context, so no session cookie authenticates the call instead of the token.
async function callWith(token: string): Promise<number> {
  const client: APIRequestContext = await request.newContext({ extraHTTPHeaders: { Connection: 'close' } });
  try {
    return (await client.get(`${API_BASE}/channels`, { headers: { authorization: `Bearer ${token}` } })).status();
  } finally {
    await client.dispose();
  }
}

async function issueAs(accessToken: string, name: string): Promise<string> {
  const client = await request.newContext({ extraHTTPHeaders: { Connection: 'close' } });
  try {
    const res = await client.post(`${API_BASE}/api-keys`, {
      headers: { authorization: `Bearer ${accessToken}` },
      data: { name, permissions: ['channels:read'], groupIds: null, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() },
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { data: { token: string } }).data.token;
  } finally {
    await client.dispose();
  }
}

test('disabling a user stops their keys, except one an admin takes over', async ({ page }) => {
  const api = await adminApi();
  try {
    await postData(api, '/users', { username: LEAVER, email: `${LEAVER}@example.test`, password: PASSWORD, role: 'admin' });
    const signIn = await api.post(`${API_BASE}/auth/login`, { data: { username: LEAVER, password: PASSWORD } });
    expect(signIn.ok()).toBeTruthy();
    const leaverToken = ((await signIn.json()) as { data: { accessToken: string } }).data.accessToken;
    const keptOld = await issueAs(leaverToken, `${LEAVER}-kept`);
    const dropped = await issueAs(leaverToken, `${LEAVER}-dropped`);
    expect(await callWith(keptOld)).toBe(200);

    await login(page);
    await page.goto('/users');
    await page.getByRole('switch', { name: `Disable ${LEAVER}` }).click();
    const dialog = page.getByRole('dialog', { name: `Disable ${LEAVER}` });
    await expect(dialog).toContainText('2 API keys they issued will stop now');
    await dialog.getByLabel(`Take ownership of ${LEAVER}-kept`).check();
    await dialog.getByRole('button', { name: 'Disable' }).click();

    const shown = page.getByRole('dialog', { name: `Token for ${LEAVER}-kept` });
    const keptNew = await shown.getByLabel('Token').inputValue();
    await shown.getByRole('button', { name: 'Done' }).click();

    expect(await callWith(keptNew)).toBe(200);
    expect(await callWith(keptOld)).toBe(401);
    expect(await callWith(dropped)).toBe(401);
  } finally {
    await api.dispose();
  }
});
