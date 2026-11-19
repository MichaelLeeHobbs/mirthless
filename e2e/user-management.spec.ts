// Users can't be deleted, only disabled, so each run creates a user with a name of its own.

import { test, expect, request, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, deleteOk, getData } from './fixtures/api.js';
import { TEST_USER } from './fixtures/test-data.js';

const RUN_ID = Date.now().toString(36);
const USERNAME = `${TEST_USER.username}-${RUN_ID}`;
const EMAIL = `e2e-${RUN_ID}@test.local`;
/** The server locks an account after this many wrong passwords in a row (auth.service.ts). */
const MAX_FAILED_ATTEMPTS = 5;

interface UserRow { readonly id: string; readonly username: string; readonly role: string; readonly enabled: boolean }

let api: APIRequestContext;

function userRow(page: Page): Locator {
  return page.getByRole('row').filter({ has: page.getByText(USERNAME, { exact: true }) });
}

async function findUser(): Promise<UserRow | undefined> {
  const users = await getData<UserRow[]>(api, '/users');
  return users.find((u) => u.username === USERNAME);
}

async function testUser(): Promise<UserRow> {
  const user = await findUser();
  expect(user, `${USERNAME} not found`).toBeDefined();
  return user as UserRow;
}

async function disableTestUsers(): Promise<void> {
  const users = await getData<UserRow[]>(api, '/users');
  for (const user of users) {
    const ours = user.username === TEST_USER.username || user.username.startsWith(`${TEST_USER.username}-`);
    if (ours && user.enabled) await deleteOk(api, `/users/${user.id}`);
  }
}

/** The login's error code, or 'OK' when it succeeds. */
async function loginAs(password: string): Promise<string> {
  const ctx = await request.newContext();
  try {
    const res = await ctx.post(`${API_BASE}/auth/login`, { data: { username: USERNAME, password } });
    if (res.ok()) return 'OK';
    return (await res.json() as { error: { code: string } }).error.code;
  } finally {
    await ctx.dispose();
  }
}

test.describe('User Management', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    await disableTestUsers();
  });

  test.afterAll(async () => {
    await disableTestUsers();
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to Users page', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
    await expect(page.getByRole('row').filter({ has: page.getByText('admin', { exact: true }) })).toBeVisible();
  });

  test('create new user', async ({ page }) => {
    await page.goto('/users');
    await page.getByRole('button', { name: 'Create User' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create User' });
    await dialog.getByLabel('Username').fill(USERNAME);
    await dialog.getByLabel('Email').fill(EMAIL);
    await dialog.getByLabel('Password').fill(TEST_USER.password);
    await dialog.getByLabel('First Name').fill(TEST_USER.firstName);
    await dialog.getByLabel('Last Name').fill(TEST_USER.lastName);
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(dialog).toBeHidden();
    const row = userRow(page);
    await expect(row).toContainText(EMAIL);
    await expect(row).toContainText(`${TEST_USER.firstName} ${TEST_USER.lastName}`);
    await expect(row.getByText('Viewer', { exact: true })).toBeVisible();
    await expect(row.getByRole('switch', { name: `Disable ${USERNAME}` })).toBeChecked();
  });

  test('edit user role', async ({ page }) => {
    await page.goto('/users');
    await userRow(page).getByRole('button', { name: 'Edit user' }).click();

    const dialog = page.getByRole('dialog', { name: 'Edit User' });
    await dialog.getByRole('combobox', { name: 'Role' }).click();
    await page.getByRole('option', { name: 'Developer', exact: true }).click();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(userRow(page).getByText('Developer', { exact: true })).toBeVisible();
    await expect.poll(async () => (await testUser()).role).toBe('developer');
  });

  test('unlock user', async ({ page }) => {
    for (let i = 1; i < MAX_FAILED_ATTEMPTS; i++) expect(await loginAs('wrong-password')).toBe('INVALID_CREDENTIALS');
    expect(await loginAs('wrong-password')).toBe('ACCOUNT_LOCKED');
    expect(await loginAs(TEST_USER.password)).toBe('ACCOUNT_LOCKED');

    const { id } = await testUser();
    await page.goto('/users');
    const unlocked = page.waitForResponse((res) => res.url().endsWith(`/users/${id}/unlock`) && res.request().method() === 'POST');
    await userRow(page).getByRole('button', { name: 'Unlock user' }).click();
    expect((await unlocked).ok()).toBeTruthy();

    expect(await loginAs(TEST_USER.password)).toBe('OK');
  });

  test('disable user', async ({ page }) => {
    await page.goto('/users');
    const row = userRow(page);
    await row.getByRole('switch', { name: `Disable ${USERNAME}` }).click();

    const confirm = page.getByRole('dialog', { name: 'Disable User' });
    await expect(confirm).toContainText(USERNAME);
    await confirm.getByRole('button', { name: 'Disable', exact: true }).click();

    await expect(confirm).toBeHidden();
    await expect(row.getByRole('switch', { name: `Enable ${USERNAME}` })).not.toBeChecked({ timeout: 5_000 });
    await expect.poll(async () => (await testUser()).enabled).toBe(false);
    expect(await loginAs(TEST_USER.password)).toBe('ACCOUNT_DEACTIVATED');
  });
});
