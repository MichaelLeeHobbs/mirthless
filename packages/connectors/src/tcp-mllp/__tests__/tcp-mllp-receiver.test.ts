// ===========================================
// TCP/MLLP Receiver Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import { TcpMllpReceiver, type TcpMllpReceiverConfig } from '../tcp-mllp-receiver.js';
import { wrapMllp, MllpParser } from '../../transmission/mllp-mode.js';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';

// ----- Helpers -----

const TEST_PORT = 16661;

function makeConfig(overrides?: Partial<TcpMllpReceiverConfig>): TcpMllpReceiverConfig {
  return {
    host: '127.0.0.1',
    port: TEST_PORT,
    maxConnections: 10,
    ...overrides,
  };
}

function makeDispatcher(
  handler?: (raw: RawMessage) => DispatchResult,
): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async (raw) => ({
    ok: true as const,
    value: handler
      ? handler(raw)
      : { messageId: 1, response: 'MSA|AA|12345' },
    error: null,
  });
}

async function connectAndSend(
  port: number,
  message: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const client = net.createConnection({ host: '127.0.0.1', port }, () => {
      client.write(wrapMllp(message));
    });

    const parser = new MllpParser();
    client.on('data', (chunk: Buffer) => {
      const msgs = parser.parse(chunk);
      if (msgs.length > 0) {
        client.end();
        resolve(msgs[0]!);
      }
    });

    client.on('error', reject);
    setTimeout(() => {
      client.destroy();
      reject(new Error('Timeout waiting for response'));
    }, 5_000);
  });
}

// ----- Lifecycle -----

let receiver: TcpMllpReceiver | null = null;

afterEach(async () => {
  if (receiver) {
    await receiver.onStop();
    await receiver.onUndeploy();
    receiver = null;
  }
});

// ----- Tests -----

describe('TcpMllpReceiver', () => {
  it('validates port on deploy', async () => {
    receiver = new TcpMllpReceiver(makeConfig({ port: -1 }));
    const result = await receiver.onDeploy();

    expect(result.ok).toBe(false);
  });

  it('starts and stops without error', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());

    const deployResult = await receiver.onDeploy();
    expect(deployResult.ok).toBe(true);

    const startResult = await receiver.onStart();
    expect(startResult.ok).toBe(true);

    const stopResult = await receiver.onStop();
    expect(stopResult.ok).toBe(true);

    receiver = null; // Already stopped
  });

  it('errors on start if dispatcher not set', async () => {
    receiver = new TcpMllpReceiver(makeConfig());

    const result = await receiver.onStart();

    expect(result.ok).toBe(false);
  });

  it('receives MLLP message and sends ACK response', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await connectAndSend(TEST_PORT, 'MSH|^~\\&|SENDER');

    expect(response).toBe('MSA|AA|12345');
  });

  it('passes sourceMap with remote connection info', async () => {
    let capturedRaw: RawMessage | null = null;

    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => {
      capturedRaw = raw;
      return { messageId: 1, response: 'ACK' };
    }));
    await receiver.onDeploy();
    await receiver.onStart();

    await connectAndSend(TEST_PORT, 'MSH|^~\\&|TEST');

    expect(capturedRaw).not.toBeNull();
    expect(capturedRaw!.sourceMap['remoteAddress']).toBe('127.0.0.1');
    expect(capturedRaw!.sourceMap['localPort']).toBe(TEST_PORT);
  });

  it('handles multiple messages on same connection', async () => {
    const received: string[] = [];
    let msgCount = 0;

    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => {
      received.push(raw.content);
      msgCount++;
      return { messageId: msgCount, response: `ACK-${String(msgCount)}` };
    }));
    await receiver.onDeploy();
    await receiver.onStart();

    const client = net.createConnection({ host: '127.0.0.1', port: TEST_PORT });
    const parser = new MllpParser();
    const responses: string[] = [];

    await new Promise<void>((resolve) => {
      client.on('connect', () => {
        client.write(wrapMllp('MSG1'));
      });

      client.on('data', (chunk: Buffer) => {
        const msgs = parser.parse(chunk);
        responses.push(...msgs);
        if (responses.length === 1) {
          // Send second message on same connection
          client.write(wrapMllp('MSG2'));
        }
        if (responses.length >= 2) {
          client.end();
          resolve();
        }
      });
    });

    expect(received).toEqual(['MSG1', 'MSG2']);
    expect(responses).toEqual(['ACK-1', 'ACK-2']);
  });

  it('halt destroys connections immediately', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    // Connect a client
    const client = net.createConnection({ host: '127.0.0.1', port: TEST_PORT });
    await new Promise<void>((resolve) => { client.on('connect', resolve); });

    const haltResult = await receiver.onHalt();
    expect(haltResult.ok).toBe(true);

    receiver = null; // Already halted
  });
});
