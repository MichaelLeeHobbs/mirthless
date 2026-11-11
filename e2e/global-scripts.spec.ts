// ===========================================
// Global Scripts E2E Tests
// ===========================================

import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { ADMIN_USER } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';

interface GlobalScripts {
  readonly deploy: string;
  readonly undeploy: string;
  readonly preprocessor: string;
  readonly postprocessor: string;
}

let api: APIRequestContext;
let original: GlobalScripts;

async function savedScripts(): Promise<GlobalScripts> {
  const res = await api.get(`${API_BASE}/global-scripts`);
  expect(res.ok(), `GET /global-scripts returned ${String(res.status())}`).toBeTruthy();
  return (await res.json() as { data: GlobalScripts }).data;
}

/**
 * Add a line at the end of the open editor and save. The text goes in as one
 * edit: typing it key by key raced the editor and saved a script with
 * characters missing, which then could not compile.
 */
async function appendLineAndSave(page: Page, line: string): Promise<void> {
  const editor = page.locator('.monaco-editor').first();
  await expect(editor.locator('.view-line').first()).toBeVisible();
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText(`\n${line}`);
  await page.getByRole('button', { name: /save/i }).click();
  await expect(page.getByText('Global scripts saved')).toBeVisible();
}

test.describe('Global Scripts', () => {
  test.beforeAll(async () => {
    const loginCtx = await request.newContext();
    const loginRes = await loginCtx.post(`${API_BASE}/auth/login`, { data: ADMIN_USER });
    expect(loginRes.ok(), `Admin login failed: ${String(loginRes.status())}`).toBeTruthy();
    const { accessToken } = (await loginRes.json() as { data: { accessToken: string } }).data;
    await loginCtx.dispose();
    api = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` } });
    original = await savedScripts();
  });

  // The scripts are server-wide: put them back so later specs deploy with the seeded ones.
  test.afterAll(async () => {
    if (original) await api.put(`${API_BASE}/global-scripts`, { data: original });
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to Global Scripts page', async ({ page }) => {
    await page.goto('/global-scripts');
    await expect(page.getByRole('heading', { name: 'Global Scripts' })).toBeVisible();
    // Should show 4 tabs
    await expect(page.getByRole('tab', { name: 'Deploy', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Undeploy' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Preprocessor' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Postprocessor' })).toBeVisible();
  });

  test('enter deploy script code and save', async ({ page }) => {
    await page.goto('/global-scripts');

    // Deploy tab should be active by default
    await expect(page.getByRole('tab', { name: 'Deploy', exact: true, selected: true })).toBeVisible();

    await appendLineAndSave(page, '// E2E test deploy script');

    expect((await savedScripts()).deploy).toBe(`${original.deploy}\n// E2E test deploy script`);
  });

  test('code persists after page refresh', async ({ page }) => {
    await page.goto('/global-scripts');

    await expect(page.locator('.monaco-editor').first()).toContainText('E2E test deploy script');
  });

  test('switch to preprocessor tab and edit', async ({ page }) => {
    await page.goto('/global-scripts');

    // Click Preprocessor tab
    await page.getByRole('tab', { name: 'Preprocessor' }).click();

    await appendLineAndSave(page, '// E2E preprocessor');

    expect((await savedScripts()).preprocessor).toBe(`${original.preprocessor}\n// E2E preprocessor`);
  });
});
