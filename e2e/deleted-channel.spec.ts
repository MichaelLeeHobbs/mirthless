// Deleting a channel keeps its messages: they are found and marked, and an administrator removes them (#202).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { adminApi, createMllpChannel, deployAndStart, getData, removeChannel } from './fixtures/api.js';
import { sendMllpMessage } from './fixtures/mllp.js';

// Of this run: deleted channels of earlier runs stay in the lists.
const CHANNEL_NAME = `E2E Deleted ${String(Date.now())}`;
const MLLP_PORT = 18687;
const HL7_ADT = [
  'MSH|^~\\&|E2E_SENDER|FACILITY|E2E_RECEIVER|FACILITY|20261125140000||ADT^A01|E2E-DELETED-1|P|2.5',
  'EVN|A01|20261125140000',
  'PID|||E2E997^^^MRN||DELETED^CHANNEL||19900101|F',
].join('\r');

let api: APIRequestContext;
let channelId = '';

const total = async (): Promise<number> => (await getData<{ total: number }>(api, `/channels/${channelId}/messages`)).total;

async function openMessages(page: Page): Promise<void> {
  await page.goto('/messages');
  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByRole('row').filter({ has: page.getByRole('button', { name: CHANNEL_NAME, exact: true }) }).first()
    .getByRole('button', { name: CHANNEL_NAME, exact: true }).click();
}

test.describe('The messages of a deleted channel', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    channelId = await createMllpChannel(api, { name: CHANNEL_NAME, port: MLLP_PORT });
    await deployAndStart(api, channelId);
    expect(await sendMllpMessage(MLLP_PORT, HL7_ADT)).toContain('MSA|AA|E2E-DELETED-1');
    await expect.poll(total).toBe(1);
    await removeChannel(api, channelId);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('are found in Traffic, marked as a deleted channel\'s', async ({ page }) => {
    await page.goto('/messages');
    await page.getByRole('tab', { name: 'Search' }).click();

    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: CHANNEL_NAME, exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Deleted');
  });

  test('are shown in the message browser, which says that the channel is deleted', async ({ page }) => {
    await openMessages(page);

    await expect(page.getByRole('alert')).toContainText('This channel is deleted. Its messages are kept');
    await page.locator('table tbody tr').first().click();
    await expect(page.getByRole('button', { name: 'Reprocess' })).toBeDisabled();
    await expect(page.getByText('DELETED^CHANNEL')).toBeVisible();
  });

  test('are removed by an administrator who gives a reason and types the name', async ({ page }) => {
    await page.goto('/system/pruner');
    await page.getByRole('button', { name: `Delete the messages of ${CHANNEL_NAME}` }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('1 message');
    const remove = dialog.getByRole('button', { name: 'Delete messages' });
    await expect(remove).toBeDisabled();
    await dialog.getByLabel('Reason').fill('end-to-end test');
    await dialog.getByLabel(`Type ${CHANNEL_NAME} to confirm`).fill(CHANNEL_NAME);
    await remove.click();

    await expect(page.getByText(`Deleted 1 message of ${CHANNEL_NAME}`)).toBeVisible();
    await expect(page.getByRole('button', { name: `Delete the messages of ${CHANNEL_NAME}` })).toHaveCount(0);
    expect(await total()).toBe(0);
  });

  test('and that is in the audit log, with the reason', async () => {
    const audit = await getData<{ data: Array<{ channelId: string; outcome: string; attributes: Record<string, unknown> }> }>(api, '/audit?action=MESSAGES_PURGED');
    expect(audit.data.find((e) => e.channelId === channelId)).toMatchObject({
      outcome: 'SUCCESS', attributes: { channelName: CHANNEL_NAME, messages: 1, reason: 'end-to-end test' },
    });
  });
});
