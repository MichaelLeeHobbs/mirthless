// Users can't be deleted, so each run uses names of its own (D-289).

import { test, expect, request, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData, postData } from './fixtures/api.js';

const RUN_ID = Date.now().toString(36);
const ROLE = `e2e-reader-${RUN_ID}`;
const USERNAME = `e2e-role-user-${RUN_ID}`;
const PASSWORD = 'RoleTest123!';

interface RoleRow { readonly id: string; readonly name: string; readonly permissions: readonly string[]; readonly holders: number }
interface UserRow { readonly id: string; readonly username: string; readonly enabled: boolean }

let api: APIRequestContext;

async function findRole(): Promise<RoleRow | undefined> {
  return (await getData<RoleRow[]>(api, '/roles')).find((r) => r.name === ROLE);
}

async function findUser(): Promise<UserRow | undefined> {
  return (await getData<UserRow[]>(api, '/users')).find((u) => u.username === USERNAME);
}

test.describe.serial('Roles', () => {
  test.beforeAll(async () => {
    api = await adminApi();
  });

  test.afterAll(async () => {
    const user = await findUser();
    if (user) {
      await api.put(`${API_BASE}/users/${user.id}`, { data: { role: 'viewer' } });
      if (user.enabled) await deleteOk(api, `/users/${user.id}`);
    }
    const role = await findRole();
    if (role) await deleteOk(api, `/roles/${role.id}`);
    await api.dispose();
  });

  test('clone a built-in role and narrow it', async ({ page }) => {
    await login(page);
    await page.goto('/roles');
    await expect(page.getByRole('heading', { level: 1, name: 'Roles' })).toBeVisible();

    await page.getByRole('button', { name: 'Clone viewer' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Clone role: viewer' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Name' }).fill(ROLE);
    // Narrow it: no collections (they reach every channel's data).
    await page.getByRole('checkbox', { name: /^Read collections/ }).uncheck();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Roles' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: ROLE })).toContainText('Nobody');
    const role = await findRole();
    expect(role?.permissions).toContain('channels:read');
    expect(role?.permissions).not.toContain('collections:read');
  });

  test('a user holding the role gets exactly what it grants', async ({ page }) => {
    await postData(api, '/users', { username: USERNAME, email: `${USERNAME}@test.local`, password: PASSWORD, role: ROLE });

    await login(page, { username: USERNAME, password: PASSWORD });
    const link = (name: string) => page.getByRole('link', { name, exact: true });
    await expect(link('Code Templates')).toBeVisible();
    await expect(link('Collections')).toHaveCount(0);
    await expect(link('Roles')).toHaveCount(0);
    await expect(link('Users')).toHaveCount(0);

    await page.goto('/roles');
    await expect(page.getByText('Not authorized')).toBeVisible();

    // The server refuses it too: the screens only follow what it enforces.
    const userApi = await request.newContext();
    const signIn = await userApi.post(`${API_BASE}/auth/login`, { data: { username: USERNAME, password: PASSWORD } });
    const token = ((await signIn.json()) as { data: { accessToken: string } }).data.accessToken;
    const collections = await userApi.get(`${API_BASE}/collections`, { headers: { authorization: `Bearer ${token}` } });
    expect(collections.status()).toBe(403);
    await userApi.dispose();
  });

  test('a role still assigned cannot be deleted', async ({ page }) => {
    await login(page);
    await page.goto('/roles');
    const row = page.getByRole('row').filter({ hasText: ROLE });
    await expect(row).toContainText('1 user');
    await expect(row.getByRole('button', { name: `Delete ${ROLE}` })).toBeDisabled();

    const role = await findRole();
    const refused = await api.delete(`${API_BASE}/roles/${role?.id ?? ''}`);
    expect(refused.status()).toBe(409);
    expect(JSON.stringify(await refused.json())).toContain(USERNAME);
  });
});
