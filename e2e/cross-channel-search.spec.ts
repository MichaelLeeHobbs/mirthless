// ===========================================
// Traffic & Triage E2E Tests (cross-channel)
// ===========================================
// The Traffic page's search runs across every channel, and other specs send
// messages in parallel, so this spec sends one message through a channel of
// its own and checks the search finds or drops that message's row as the
// filters change. Empty states are checked against a stubbed empty result.

import { test, expect, type APIRequestContext, type Locator, type Page, type Response } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, createMllpChannel, deployAndStart, getData, removeChannel, removeChannelsNamed } from './fixtures/api.js';
import { sendMllpMessage } from './fixtures/mllp.js';

const CHANNEL_NAME = 'E2E Traffic Search Channel';
const MLLP_PORT = 18681;

const HL7_ADT = [
  'MSH|^~\\&|E2E_SENDER|FACILITY|E2E_RECEIVER|FACILITY|20260228140000||ADT^A01|E2E-TRAFFIC-1|P|2.5',
  'EVN|A01|20260228140000',
  'PID|||E2E998^^^MRN||TRAFFIC^SEARCH||19900101|F',
].join('\r');

interface SearchItem { readonly messageId: number; readonly receivedAt: string; readonly status: string | null }

let api: APIRequestContext;
let channelId = '';
let message: SearchItem;

/** A time as the value of a datetime-local input (browser and test share the host's time zone). */
function localMinute(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Wait for the cross-channel search request whose query has this parameter value. */
function searchResponse(page: Page, param: string, value: string): Promise<Response> {
  return page.waitForResponse((res) => {
    const url = new URL(res.url());
    return url.pathname === '/api/v1/messages' && url.searchParams.get(param) === value;
  });
}

/**
 * This run's message row: its ID and its channel's name. The ID matters because
 * Traffic still lists the messages of a deleted channel, so earlier runs'
 * messages show under the same channel name.
 */
function messageRow(page: Page): Locator {
  return page.getByRole('row')
    .filter({ has: page.getByRole('cell', { name: String(message.messageId), exact: true }) })
    .filter({ has: page.getByRole('button', { name: CHANNEL_NAME, exact: true }) });
}

/** The Status filter. */
function statusSelect(page: Page): Locator {
  return page.getByRole('combobox', { name: 'Status', exact: true });
}

test.describe('Traffic & Triage', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    await removeChannelsNamed(api, CHANNEL_NAME);
    channelId = await createMllpChannel(api, { name: CHANNEL_NAME, port: MLLP_PORT });
    await deployAndStart(api, channelId);

    expect(await sendMllpMessage(MLLP_PORT, HL7_ADT)).toContain('MSA|AA|E2E-TRAFFIC-1');
    await expect.poll(async () =>
      (await getData<{ items: SearchItem[] }>(api, `/messages?channelIds=${channelId}`)).items.length,
    ).toBe(1);
    [message] = (await getData<{ items: [SearchItem] }>(api, `/messages?channelIds=${channelId}`)).items;
  });

  test.afterAll(async () => {
    if (channelId) await removeChannel(api, channelId);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('navigate to the Traffic page and verify heading + tabs', async ({ page }) => {
    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Traffic' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: /Needs Attention/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Search' })).toBeVisible();
  });

  test('search filter controls are visible on the Search tab', async ({ page }) => {
    await page.goto('/messages');
    await page.getByRole('tab', { name: 'Search' }).click();

    await expect(page.getByRole('tab', { name: 'Search' })).toHaveAttribute('aria-selected', 'true');
    await statusSelect(page).click();
    await expect(page.getByRole('option', { name: 'All', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'ERROR', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(page.getByLabel('From', { exact: true })).toHaveAttribute('type', 'datetime-local');
    await expect(page.getByLabel('To', { exact: true })).toHaveAttribute('type', 'datetime-local');
  });

  test('message table structure is visible', async ({ page }) => {
    await page.goto('/messages');
    for (const name of ['ID', 'Channel', 'Connector', 'Status', 'Received', 'Processed', 'Actions']) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible({ timeout: 10_000 });
    }
  });

  test('empty state message when no messages match', async ({ page }) => {
    // Other specs send messages in parallel, so the search result is stubbed empty.
    await page.route((url) => url.pathname === '/api/v1/messages', (route) =>
      route.fulfill({ json: { success: true, data: { items: [], total: 0, limit: 25, offset: 0 } } }));
    await page.goto('/messages');
    await expect(page.getByRole('heading', { name: 'Nothing needs attention' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('tab', { name: 'Search' }).click();
    await expect(page.getByRole('heading', { name: 'No messages found' })).toBeVisible();
    await expect(page.getByText('Try widening the date range or clearing the status filter.')).toBeVisible();
  });

  test('search applies and table updates', async ({ page }) => {
    const receivedAt = new Date(message.receivedAt);
    expect(message.status).not.toBe('ERROR');
    const ownStatus = message.status ?? '';

    await page.goto('/messages');
    await page.getByRole('tab', { name: 'Search' }).click();

    // From the minute this spec's message arrived: its row is there.
    const fromMinute = searchResponse(page, 'dateFrom', new Date(localMinute(receivedAt)).toISOString());
    await page.getByLabel('From', { exact: true }).fill(localMinute(receivedAt));
    await fromMinute;
    await expect(messageRow(page)).toHaveCount(1);
    // The status chip shows the status in title case (SENT as Sent).
    await expect(messageRow(page)).toContainText(new RegExp(ownStatus, 'i'));

    // Only errored messages: this one isn't, so its row goes.
    const errorsOnly = searchResponse(page, 'status', 'ERROR');
    await statusSelect(page).click();
    await page.getByRole('option', { name: 'ERROR', exact: true }).click();
    await errorsOnly;
    await expect(messageRow(page)).toHaveCount(0);

    // Its own status brings it back.
    const ownStatusOnly = searchResponse(page, 'status', ownStatus);
    await statusSelect(page).click();
    await page.getByRole('option', { name: ownStatus, exact: true }).click();
    await ownStatusOnly;
    await expect(messageRow(page)).toHaveCount(1);

    // From tomorrow: nothing has arrived yet.
    const tomorrow = localMinute(new Date(Date.now() + 86_400_000));
    const fromTomorrow = searchResponse(page, 'dateFrom', new Date(tomorrow).toISOString());
    await page.getByLabel('From', { exact: true }).fill(tomorrow);
    await fromTomorrow;
    await expect(page.getByRole('heading', { name: 'No messages found' })).toBeVisible();
  });
});
