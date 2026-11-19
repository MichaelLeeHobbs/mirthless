// Statistics and status are stubbed: other specs add and deploy channels in the shared database.

import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';

const UPDATED_AT = '2026-01-01T00:00:00.000Z';

function stat(channelId: string, channelName: string, counts: { received: number; errored: number; queued: number }): Record<string, unknown> {
  return {
    channelId, channelName, enabled: true, sourceConnectorType: 'TCP_MLLP', inboundDataType: 'HL7V2',
    outboundDataType: 'HL7V2', revision: 1, updatedAt: UPDATED_AT, filtered: 0, sent: counts.received - counts.errored, ...counts,
  };
}

const STATISTICS = [
  stat('00000000-0000-4000-8000-0000000000a1', 'E2E Dash Alpha', { received: 10, errored: 1, queued: 2 }),
  stat('00000000-0000-4000-8000-0000000000a2', 'E2E Dash Bravo', { received: 5, errored: 0, queued: 0 }),
  stat('00000000-0000-4000-8000-0000000000a3', 'E2E Dash Charlie', { received: 0, errored: 0, queued: 0 }),
];
const STATUSES = [
  { channelId: '00000000-0000-4000-8000-0000000000a1', state: 'STARTED' },
  { channelId: '00000000-0000-4000-8000-0000000000a2', state: 'STOPPED' },
];

async function serveFixedChannels(page: Page): Promise<void> {
  await page.route((url) => url.pathname === '/api/v1/channels/statistics', async (route) => {
    await route.fulfill({ json: { success: true, data: STATISTICS } });
  });
  await page.route((url) => url.pathname === '/api/v1/channels/status', async (route) => {
    await route.fulfill({ json: { success: true, data: STATUSES } });
  });
}

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to dashboard', async ({ page }) => {
    await page.goto('/alerts');
    await expect(page.getByRole('heading', { name: 'Alerts' })).toBeVisible();

    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New Channel' })).toBeEnabled();
  });

  test('signed-in user opening the login page lands on the dashboard', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('summary cards total the channel statistics', async ({ page }) => {
    await serveFixedChannels(page);
    await page.goto('/');

    // Labels like "Stopped" also appear in the table, so look only inside the row of tiles.
    const cards = page.getByText('Total Channels', { exact: true }).locator('xpath=../..');
    const tile = (label: string): ReturnType<Page['locator']> =>
      cards.getByText(label, { exact: true }).locator('xpath=..');
    await expect(tile('Total Channels')).toHaveText(/^Total Channels3$/);
    await expect(tile('Running')).toHaveText(/^Running1$/);
    await expect(tile('Stopped')).toHaveText(/^Stopped1$/);
    await expect(tile('Errored')).toHaveText(/^Errored1$/);
    await expect(tile('Queued')).toHaveText(/^Queued2$/);
    await expect(tile('Received')).toHaveText(/^Received15$/);
  });

  test('channel status table lists each channel with its state', async ({ page }) => {
    await serveFixedChannels(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'flat view' }).click();

    const row = (name: string): ReturnType<Page['locator']> => page.getByRole('row', { name: new RegExp(name) });
    await expect(row('E2E Dash Alpha').getByText('Started', { exact: true })).toBeVisible();
    await expect(row('E2E Dash Bravo').getByText('Stopped', { exact: true })).toBeVisible();
    await expect(row('E2E Dash Charlie').getByText('Undeployed', { exact: true })).toBeVisible();
    await expect(page.getByRole('row', { name: /E2E Dash/ })).toHaveText([/E2E Dash Alpha/, /E2E Dash Bravo/, /E2E Dash Charlie/]);
  });
});
