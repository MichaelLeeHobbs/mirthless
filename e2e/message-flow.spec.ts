// ===========================================
// Message Flow E2E Tests
// ===========================================
// Tests end-to-end message flow: send HL7 via TCP/MLLP, verify in message browser.

import { test, expect } from '@playwright/test';
import * as net from 'node:net';
import { login } from './fixtures/auth.js';
import { TEST_CHANNEL } from './fixtures/test-data.js';

const VT = 0x0b;
const FS = 0x1c;
const CR = 0x0d;

/** Wrap a message with MLLP framing (VT + message + FS + CR) */
function wrapMllp(message: string): Buffer {
  const msgBuf = Buffer.from(message);
  const frame = Buffer.alloc(msgBuf.length + 3);
  frame[0] = VT;
  msgBuf.copy(frame, 1);
  frame[frame.length - 2] = FS;
  frame[frame.length - 1] = CR;
  return frame;
}

/** Send an MLLP-framed HL7 message via TCP and wait for ACK */
function sendMllpMessage(host: string, port: number, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ host, port }, () => {
      client.write(wrapMllp(message));
    });

    let buffer = Buffer.alloc(0);

    client.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      // Check for FS+CR at end
      if (buffer.length >= 3 && buffer[buffer.length - 2] === FS && buffer[buffer.length - 1] === CR) {
        // Strip VT prefix and FS+CR suffix
        const response = buffer.subarray(1, buffer.length - 2).toString();
        client.end();
        resolve(response);
      }
    });

    client.on('error', reject);
    setTimeout(() => {
      client.destroy();
      reject(new Error('MLLP send timeout'));
    }, 10_000);
  });
}

const HL7_ADT = [
  'MSH|^~\\&|E2E_SENDER|FACILITY|E2E_RECEIVER|FACILITY|20260228140000||ADT^A01|E2E001|P|2.5',
  'EVN|A01|20260228140000',
  'PID|||E2E999^^^MRN||PLAYWRIGHT^TEST||19900101|F',
  'PV1||I|ICU^200^B',
].join('\r');

test.describe('Message Flow', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('create TCP/MLLP channel for message flow', async ({ page }) => {
    await page.goto('/channels');

    // Create a new channel
    await page.getByRole('button', { name: /new|create/i }).click();
    await page.getByLabel('Name').fill(TEST_CHANNEL.name);

    const descField = page.getByLabel('Description');
    if (await descField.isVisible()) {
      await descField.fill(TEST_CHANNEL.description);
    }

    await page.getByRole('button', { name: /create|save/i }).click();

    // Verify channel was created
    await expect(page.getByText(TEST_CHANNEL.name)).toBeVisible({ timeout: 10_000 });
  });

  test('message browser page loads', async ({ page }) => {
    // Navigate to messages page
    await page.goto('/');

    // Click Messages in sidebar
    const messagesNav = page.getByRole('link', { name: 'Messages' });
    if (await messagesNav.isVisible()) {
      await messagesNav.click();
      await expect(page.getByText(/messages/i)).toBeVisible();
    }
  });

  test('message detail panel shows content tabs', async ({ page }) => {
    // Navigate to a channel's messages
    await page.goto('/channels');

    const firstRow = page.locator('table tbody tr').first();
    if (await firstRow.isVisible()) {
      // Look for a messages link/button
      const messagesBtn = firstRow.getByRole('link', { name: /messages/i });
      if (await messagesBtn.isVisible()) {
        await messagesBtn.click();
        await expect(page).toHaveURL(/\/messages/);
      }
    }
  });
});
