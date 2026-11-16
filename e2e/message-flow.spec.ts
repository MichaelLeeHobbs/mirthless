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
import * as net from 'node:net';
import { login } from './fixtures/auth.js';
import { API_BASE, adminApi, getData, postData, removeChannel, removeChannelsNamed } from './fixtures/api.js';
import { TEST_CHANNEL } from './fixtures/test-data.js';

// -------------------------------------------------------
// MLLP framing constants
// -------------------------------------------------------
const VT = 0x0b;
const FS = 0x1c;
const CR = 0x0d;

/** Wrap a raw HL7 string with MLLP framing (VT + payload + FS + CR). */
function wrapMllp(message: string): Buffer {
  const msgBuf = Buffer.from(message);
  const frame = Buffer.alloc(msgBuf.length + 3);
  frame[0] = VT;
  msgBuf.copy(frame, 1);
  frame[frame.length - 2] = FS;
  frame[frame.length - 1] = CR;
  return frame;
}

/**
 * Send an MLLP-framed HL7 message via TCP and return the raw ACK string.
 * Rejects with an error if no ACK is received within 10 seconds.
 */
function sendMllpMessage(host: string, port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host, port }, () => {
      client.write(wrapMllp(message));
    });

    let buffer = Buffer.alloc(0);

    client.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Complete MLLP frame ends with FS + CR
      if (buffer.length >= 3 && buffer[buffer.length - 2] === FS && buffer[buffer.length - 1] === CR) {
        const response = buffer.subarray(1, buffer.length - 2).toString();
        client.end();
        resolve(response);
      }
    });

    client.on('error', reject);

    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('MLLP send timeout'));
    }, 10_000);

    client.on('close', () => clearTimeout(timer));
  });
}

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
    const created = await postData<{ id: string }>(api, '/channels', {
      name: TEST_CHANNEL.name,
      description: TEST_CHANNEL.description,
      enabled: true,
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
      sourceConnectorProperties: {
        host: '127.0.0.1',
        port: MLLP_PORT,
        maxConnections: 10,
        responseMode: 'AUTO_ACK',
        charset: 'utf-8',
        maxFrameBytes: 52428800,
      },
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    channelId = created.id;
  });

  test('deploy and start channel via API', async () => {
    await postData(api, `/channels/${channelId}/deploy`);
    const status = await getData<{ state: string }>(api, `/channels/${channelId}/status`);
    if (status.state !== 'STARTED') {
      await postData(api, `/channels/${channelId}/start`);
    }
    await expect.poll(async () => (await getData<{ state: string }>(api, `/channels/${channelId}/status`)).state)
      .toBe('STARTED');
  });

  test('send HL7 ADT^A01 and receive ACK', async () => {
    const ack = await sendMllpMessage('127.0.0.1', MLLP_PORT, HL7_ADT);

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
