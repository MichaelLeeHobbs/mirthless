// ===========================================
// Message Flow E2E Tests
// ===========================================
// Tests end-to-end message flow: create a TCP/MLLP channel via API,
// deploy and start it, send an HL7 ADT^A01 message, verify ACK,
// then confirm the message appears in the browser UI.
//
// The steps run serially and every step must succeed: a failed setup step
// fails the suite rather than skipping the message checks.

import { test, expect, type APIRequestContext } from '@playwright/test';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, createMllpChannel, deployAndStart, getData, postData, removeChannel, removeChannelsNamed } from './fixtures/api.js';
import { sendMllpMessage } from './fixtures/mllp.js';
import { TEST_CHANNEL } from './fixtures/test-data.js';

// -------------------------------------------------------
// Sample HL7 ADT^A01 message
// -------------------------------------------------------
const HL7_ADT = [
  'MSH|^~\\&|E2E_SENDER|FACILITY|E2E_RECEIVER|FACILITY|20260228140000||ADT^A01|E2E001|P|2.5',
  'EVN|A01|20260228140000',
  'PID|||E2E999^^^MRN||PLAYWRIGHT^TEST||19900101|F',
  'PV1||I|ICU^200^B',
].join('\r');

// -------------------------------------------------------
// Shared state across tests in this suite
// -------------------------------------------------------
let api: APIRequestContext;
let channelId = '';
const MLLP_PORT = TEST_CHANNEL.sourcePort; // 18661

// -------------------------------------------------------
// Tests
// -------------------------------------------------------
test.describe('Message Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    api = await adminApi();
    await removeChannelsNamed(api, TEST_CHANNEL.name);
  });

  test.afterAll(async () => {
    if (channelId) await removeChannel(api, channelId);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('create TCP/MLLP channel via API', async () => {
    channelId = await createMllpChannel(api, {
      name: TEST_CHANNEL.name,
      description: TEST_CHANNEL.description,
      port: MLLP_PORT,
    });
    expect(channelId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('deploy and start channel via API', async () => {
    await deployAndStart(api, channelId);
  });

  test('send HL7 ADT^A01 and receive ACK', async () => {
    const ack = await sendMllpMessage(MLLP_PORT, HL7_ADT);

    expect(ack).toContain('MSH');
    expect(ack).toContain('MSA|AA|E2E001');
  });

  test('message is stored and appears in the message browser', async ({ page }) => {
    await expect.poll(async () =>
      (await getData<{ total: number }>(api, `/channels/${channelId}/messages`)).total,
    ).toBeGreaterThanOrEqual(1);

    await page.goto(`/channels/${channelId}/messages`);
    await expect(page.getByRole('heading', { level: 1, name: `${TEST_CHANNEL.name} messages` }))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator('table tbody tr').first()).toContainText(/Sent|Transformed|Received/, { timeout: 10_000 });
  });

  test('stop, undeploy and delete channel', async ({ page }) => {
    await postData(api, `/channels/${channelId}/stop`);
    await postData(api, `/channels/${channelId}/undeploy`);
    const deleteRes = await api.delete(`${API_BASE}/channels/${channelId}`);
    expect([200, 204]).toContain(deleteRes.status());
    channelId = '';

    // The channel list lives on the Dashboard.
    await page.goto('/');
    await expect(page.locator('tr', { hasText: TEST_CHANNEL.name })).toHaveCount(0, { timeout: 10_000 });
  });
});
