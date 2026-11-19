import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, getData } from './fixtures/api.js';

interface SystemInfo {
  readonly server: { readonly version: string; readonly nodeVersion: string; readonly env: string };
  readonly os: { readonly arch: string; readonly cpus: number };
}

let api: APIRequestContext;

test.describe('System Info', () => {
  test.beforeAll(async () => {
    api = await adminApi();
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to system info page', async ({ page }) => {
    await page.goto('/system');
    await expect(page.getByRole('heading', { level: 1, name: 'System Information' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Overview', selected: true })).toBeVisible();
  });

  test('key sections are visible', async ({ page }) => {
    await page.goto('/system');

    await expect(page.getByRole('region', { name: 'System status' })).toBeVisible();
    for (const section of ['Server', 'Database', 'Process memory', 'Host']) {
      await expect(page.getByRole('region', { name: section, exact: true })).toBeVisible();
    }
    await expect(page.getByLabel(/^Database: Connected/)).toBeVisible();
  });

  test('version information is displayed', async ({ page }) => {
    const info = await getData<SystemInfo>(api, '/system');
    await page.goto('/system');

    const fact = (panel: string, term: string): ReturnType<typeof page.locator> =>
      page.getByRole('region', { name: panel, exact: true }).locator(`dt:text-is("${term}") + dd`);
    await expect(fact('Server', 'Version')).toHaveText(info.server.version);
    await expect(fact('Server', 'Node.js')).toHaveText(info.server.nodeVersion);
    await expect(fact('Server', 'Environment')).toHaveText(info.server.env);
    await expect(fact('Host', 'Architecture')).toHaveText(info.os.arch);
    await expect(fact('Host', 'CPUs')).toHaveText(String(info.os.cpus));
  });

  test('each tab has its own address', async ({ page }) => {
    await page.goto('/system');
    await expect(page.getByRole('region', { name: 'System status' })).toBeVisible();
    await expect(page.getByLabel(/^Database: Connected/)).toBeVisible();

    await page.getByRole('tab', { name: 'Logs' }).click();
    await expect(page).toHaveURL(/\/system\/logs$/);
    await expect(page.getByText('Server Logs')).toBeVisible();

    await page.goto('/system/pruner');
    await expect(page.getByRole('tab', { name: 'Data pruner', selected: true })).toBeVisible();
  });
});
