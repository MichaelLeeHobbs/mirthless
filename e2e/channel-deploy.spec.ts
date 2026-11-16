// ===========================================
// Channel Deploy E2E Tests
// ===========================================
// Deploys, starts, stops and undeploys a channel of this spec's own from the
// dashboard's bulk actions toolbar, and checks the state after each step in
// both the row's status chip and the API.

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, getData, postData, removeChannel, removeChannelsNamed } from './fixtures/api.js';
import { DEPLOY_CHANNEL } from './fixtures/test-data.js';

let api: APIRequestContext;
let channelId = '';

/** Show the dashboard as a flat table (the grouped view has no checkboxes) and select this spec's channel. */
async function selectChannel(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'flat view' }).click();
  await page.getByRole('row', { name: new RegExp(DEPLOY_CHANNEL.name) }).getByRole('checkbox').check();
  await expect(page.getByText('1 selected')).toBeVisible();
}

/** Click a bulk action and wait until the row's chip and the API both show the expected state. */
async function runAction(page: Page, action: 'Deploy' | 'Start' | 'Stop' | 'Undeploy', state: string): Promise<void> {
  await selectChannel(page);
  const toolbar = page.getByText('1 selected').locator('..');
  await toolbar.getByRole('button', { name: action, exact: true }).click();

  const row = page.getByRole('row', { name: new RegExp(DEPLOY_CHANNEL.name) });
  const label = state.charAt(0) + state.slice(1).toLowerCase();
  await expect(row.getByText(label, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(channelState).toBe(state);
}

/** The channel's state from the API. The status endpoint answers 404 for a channel that isn't deployed. */
async function channelState(): Promise<string> {
  const res = await api.get(`${API_BASE}/channels/${channelId}/status`);
  if (res.status() === 404) return 'UNDEPLOYED';
  return (await getData<{ state: string }>(api, `/channels/${channelId}/status`)).state;
}

test.describe('Channel Deployment', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    await removeChannelsNamed(api, DEPLOY_CHANNEL.name);
    const created = await postData<{ id: string }>(api, '/channels', {
      name: DEPLOY_CHANNEL.name,
      enabled: true,
      initialState: 'STOPPED',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {
        host: '127.0.0.1',
        port: DEPLOY_CHANNEL.sourcePort,
        maxConnections: 10,
        responseMode: 'AUTO_ACK',
        charset: 'utf-8',
        maxFrameBytes: 52428800,
      },
    });
    channelId = created.id;
  });

  test.afterAll(async () => {
    if (channelId) await removeChannel(api, channelId);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('new channel shows as undeployed on the dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'flat view' }).click();
    const row = page.getByRole('row', { name: new RegExp(DEPLOY_CHANNEL.name) });
    await expect(row.getByText('Undeployed', { exact: true })).toBeVisible();
  });

  test('deploy channel from dashboard', async ({ page }) => {
    await runAction(page, 'Deploy', 'STOPPED');
  });

  test('start deployed channel', async ({ page }) => {
    await runAction(page, 'Start', 'STARTED');
  });

  test('stop running channel', async ({ page }) => {
    await runAction(page, 'Stop', 'STOPPED');
  });

  test('undeploy stopped channel', async ({ page }) => {
    await runAction(page, 'Undeploy', 'UNDEPLOYED');
  });
});
