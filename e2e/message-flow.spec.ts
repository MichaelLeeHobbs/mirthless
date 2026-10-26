// ===========================================
// Message Flow E2E Tests
// ===========================================
// Tests end-to-end message flow: create a TCP/MLLP channel via API,
// deploy and start it, send an HL7 ADT^A01 message, verify ACK,
// then confirm the message appears in the browser UI.
//
// The steps run serially and every step must succeed: a failed setup step
// fails the suite rather than skipping the message checks.

import { test, expect, request, type APIRequestContext } from '@playwright/test';
import * as net from 'node:net';
import { login } from './fixtures/auth.js';
import { ADMIN_USER, TEST_CHANNEL } from './fixtures/test-data.js';

const API_BASE = 'http://localhost:3000/api/v1';

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

interface Envelope<T> { readonly success: boolean; readonly data: T }

/** GET an API path and return its data, failing the test on a non-2xx. */
async function getData<T>(path: string): Promise<T> {
  const res = await api.get(`${API_BASE}${path}`);
  expect(res.ok(), `GET ${path} returned ${String(res.status())}`).toBeTruthy();
  return (await res.json() as Envelope<T>).data;
}

/** POST to an API path, failing the test on a non-2xx. */
async function postOk(path: string, data?: unknown): Promise<unknown> {
  const res = await api.post(`${API_BASE}${path}`, data === undefined ? {} : { data });
  expect(res.ok(), `POST ${path} returned ${String(res.status())}: ${await res.text()}`).toBeTruthy();
  return (await res.json() as Envelope<unknown>).data;
}

/** Stop, undeploy (ignoring "not deployed") and delete a channel. */
async function removeChannel(id: string): Promise<void> {
  await api.post(`${API_BASE}/channels/${id}/stop`);
  await api.post(`${API_BASE}/channels/${id}/undeploy`);
  await api.delete(`${API_BASE}/channels/${id}`);
}

// -------------------------------------------------------
// Tests
// -------------------------------------------------------
test.describe('Message Flow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const loginCtx = await request.newContext();
    const loginRes = await loginCtx.post(`${API_BASE}/auth/login`, { data: ADMIN_USER });
    expect(loginRes.ok(), `Admin login failed: ${String(loginRes.status())}`).toBeTruthy();
    const { accessToken } = (await loginRes.json() as Envelope<{ accessToken: string }>).data;
    await loginCtx.dispose();

    api = await request.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${accessToken}` } });

    // Remove leftovers from an earlier, interrupted run.
    const list = await getData<{ data: Array<{ id: string; name: string }> }>('/channels?pageSize=100');
    for (const ch of list.data) {
      if (ch.name === TEST_CHANNEL.name) await removeChannel(ch.id);
    }
  });

  test.afterAll(async () => {
    if (channelId) await removeChannel(channelId);
    await api?.dispose();
  });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('create TCP/MLLP channel via API', async () => {
    const created = await postOk('/channels', {
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
    }) as { id: string };
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    channelId = created.id;
  });

  test('deploy and start channel via API', async () => {
    await postOk(`/channels/${channelId}/deploy`);
    const status = await getData<{ state: string }>(`/channels/${channelId}/status`);
    if (status.state !== 'STARTED') {
      await postOk(`/channels/${channelId}/start`);
    }
    await expect.poll(async () => (await getData<{ state: string }>(`/channels/${channelId}/status`)).state)
      .toBe('STARTED');
  });

  test('send HL7 ADT^A01 and receive ACK', async () => {
    const ack = await sendMllpMessage('127.0.0.1', MLLP_PORT, HL7_ADT);

    expect(ack).toContain('MSH');
    expect(ack).toContain('MSA|AA|E2E001');
  });

  test('message is stored and appears in the message browser', async ({ page }) => {
    await expect.poll(async () =>
      (await getData<{ total: number }>(`/channels/${channelId}/messages`)).total,
    ).toBeGreaterThanOrEqual(1);

    await page.goto(`/channels/${channelId}/messages`);
    await expect(page.getByRole('heading', { level: 1, name: `Messages: ${TEST_CHANNEL.name}` }))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator('table tbody tr').first()).toContainText(/SENT|TRANSFORMED|RECEIVED/, { timeout: 10_000 });
  });

  test('stop, undeploy and delete channel', async ({ page }) => {
    await postOk(`/channels/${channelId}/stop`);
    await postOk(`/channels/${channelId}/undeploy`);
    const deleteRes = await api.delete(`${API_BASE}/channels/${channelId}`);
    expect([200, 204]).toContain(deleteRes.status());
    channelId = '';

    // The channel list lives on the Dashboard.
    await page.goto('/');
    await expect(page.locator('tr', { hasText: TEST_CHANNEL.name })).toHaveCount(0, { timeout: 10_000 });
  });
});
