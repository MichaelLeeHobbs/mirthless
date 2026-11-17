// ===========================================
// API keys E2E Tests (#267 slice 13)
// ===========================================
// An admin issues a key on the API keys page, copies its token from the one
// dialog that shows it, and the token works against the API. A planned
// replace hands out a new token while the old one keeps working; a revoke
// with a reason stops every token at once.
//
// Keys are never deleted, so each run uses a name of its own (D-289).

import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE } from './fixtures/api.js';

const RUN_ID = Date.now().toString(36);
const KEY_NAME = `e2e-key-${RUN_ID}`;

/** A datetime-local value 30 days on, in the browser's zone (this machine's). */
function inThirtyDays(): string {
  const when = new Date(Date.now() + 30 * 86_400_000);
  return new Date(when.getTime() - when.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** The status of GET /channels with `token`, from a client that holds no cookies. */
async function callWith(token: string): Promise<number> {
  const client: APIRequestContext = await request.newContext({ extraHTTPHeaders: { Connection: 'close' } });
  try {
    return (await client.get(`${API_BASE}/channels`, { headers: { authorization: `Bearer ${token}` } })).status();
  } finally {
    await client.dispose();
  }
}

test.describe.serial('API keys', () => {
  let firstToken = '';
  let nextToken = '';

  test('issue a key and use its token once it is shown', async ({ page }) => {
    await login(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: 'New key' }).click();
    const dialog = page.getByRole('dialog', { name: 'New API key' });
    await dialog.getByLabel('Name').fill(KEY_NAME);
    await dialog.getByLabel('Permissions').click();
    await page.getByRole('option', { name: 'Read channels' }).click();
    await dialog.getByLabel('Ends').fill(inThirtyDays());
    await dialog.getByRole('button', { name: 'Issue key' }).click();

    const shown = page.getByRole('dialog', { name: `Token for ${KEY_NAME}` });
    const token = await shown.getByLabel('Token').inputValue();
    expect(token).toMatch(/^gf_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}$/);
    firstToken = token;
    await shown.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByRole('row', { name: new RegExp(KEY_NAME) })).toContainText('Active');
    expect(await callWith(token)).toBe(200);
  });

  test('a planned replace gives a new token and keeps the old one working', async ({ page }) => {
    await login(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: `Replace ${KEY_NAME}` }).click();
    await page.getByRole('button', { name: /Planned/ }).click();
    const shown = page.getByRole('dialog', { name: `Token for ${KEY_NAME}` });
    await expect(shown).toContainText('The old token keeps working until');
    const next = await shown.getByLabel('Token').inputValue();
    expect(next).not.toBe(firstToken);
    nextToken = next;
    await shown.getByRole('button', { name: 'Done' }).click();
    expect(await callWith(next)).toBe(200);
    expect(await callWith(firstToken)).toBe(200);
  });

  test('revoking with a reason stops every token at once', async ({ page }) => {
    await login(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: `Revoke ${KEY_NAME}` }).click();
    const confirm = page.getByRole('dialog', { name: 'Revoke key' });
    await confirm.getByLabel('Why').fill('e2e run finished');
    await confirm.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('row', { name: new RegExp(KEY_NAME) })).toContainText('Revoked');
    expect(await callWith(firstToken)).toBe(401);
    expect(await callWith(nextToken)).toBe(401);
  });
});
