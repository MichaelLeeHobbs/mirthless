// ===========================================
// TCP/MLLP Receiver Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import * as net from 'node:net';
import * as tls from 'node:tls';
import {
  TcpMllpReceiver,
  MLLP_RESPONSE_MODE,
  type TcpMllpReceiverConfig,
} from '../tcp-mllp-receiver.js';
import { wrapMllp, MllpParser } from '../../transmission/mllp-mode.js';
import type { RawMessage, DispatchResult } from '../../base.js';
import { DISPATCH_STATUS } from '../../base.js';
import type { Result } from '@mirthless/core-util';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';

// ----- Helpers -----

const TEST_PORT = 16661;

const VALID_HL7 = 'MSH|^~\\&|SEND|FAC|RECV|RFAC|20240101||ADT^A01|MSGID123|P|2.5.1';

function makeConfig(overrides?: Partial<TcpMllpReceiverConfig>): TcpMllpReceiverConfig {
  return {
    host: '127.0.0.1',
    port: TEST_PORT,
    maxConnections: 10,
    responseMode: MLLP_RESPONSE_MODE.AUTO_ACK,
    charset: 'utf-8',
    maxFrameBytes: 50 * 1024 * 1024,
    ...overrides,
  };
}

/** A mock logger capturing structured calls. */
function makeLogger(): {
  logger: { error: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void; info: () => void; debug: () => void };
  errors: Array<{ obj: unknown; msg: string }>;
} {
  const errors: Array<{ obj: unknown; msg: string }> = [];
  return {
    errors,
    logger: {
      error: (obj: unknown, msg: string): void => { errors.push({ obj, msg }); },
      warn: (): void => {},
      info: (): void => {},
      debug: (): void => {},
    },
  };
}

/** Dispatcher that returns a failed Result (processing error → AE). */
function failingDispatcher(): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async () => ({ ok: false as const, value: null, error: new Error('pipeline boom') });
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

/** Connect over TLS and return the first framed response. */
async function connectAndSendTls(port: number, message: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const client = tls.connect({ host: '127.0.0.1', port, ca: TEST_CERT_PEM }, () => {
      client.write(wrapMllp(message));
    });
    const parser = new MllpParser();
    client.on('data', (chunk: Buffer) => {
      const msgs = parser.parse(chunk);
      if (msgs.length > 0) { client.end(); resolve(msgs[0]!); }
    });
    client.on('error', reject);
    setTimeout(() => { client.destroy(); reject(new Error('Timeout')); }, 5_000);
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

  it('auto-generates a real HL7 ACK (AA) from the inbound MSH, not destination content', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    // Destination "response" is a FILE PATH — it must NEVER be framed as the ACK.
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1, response: '/var/data/out/123.txt' })));
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await connectAndSend(TEST_PORT, VALID_HL7);

    expect(response.startsWith('MSH')).toBe(true);
    expect(response).toContain('MSA|AA|MSGID123');
    expect(response).not.toContain('/var/data/out/123.txt');
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
    // AUTO_ACK ignores destination content and returns two acknowledgements.
    expect(responses).toHaveLength(2);
    for (const r of responses) expect(r).toContain('MSA|AA');
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

describe('TcpMllpReceiver acknowledgements', () => {
  it('returns a NAK (AE) when the pipeline errors', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(failingDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await connectAndSend(TEST_PORT, VALID_HL7);

    expect(response).toContain('MSA|AE|MSGID123');
  });

  it('returns a NAK (AR) when the message is filtered/rejected', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1, status: DISPATCH_STATUS.FILTERED })));
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await connectAndSend(TEST_PORT, VALID_HL7);

    expect(response).toContain('MSA|AR|MSGID123');
  });

  it('returns a NAK (AE) when status is ERROR even if the Result is ok', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1, status: DISPATCH_STATUS.ERROR })));
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await connectAndSend(TEST_PORT, VALID_HL7);

    expect(response).toContain('MSA|AE|MSGID123');
  });

  it('PASSTHROUGH mode returns the destination response verbatim', async () => {
    receiver = new TcpMllpReceiver(makeConfig({ responseMode: MLLP_RESPONSE_MODE.PASSTHROUGH }));
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1, response: 'CUSTOM|RESPONSE' })));
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await connectAndSend(TEST_PORT, VALID_HL7);

    expect(response).toBe('CUSTOM|RESPONSE');
  });

  it('processes and ACKs two frames in one chunk strictly in order', async () => {
    const order: string[] = [];
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(async (raw) => {
      // First frame is slow; if processing raced, ACKs would interleave.
      const delay = raw.content.includes('FIRST') ? 60 : 0;
      await new Promise<void>((r) => setTimeout(r, delay));
      order.push(raw.content);
      return { ok: true as const, value: { messageId: order.length, response: raw.content }, error: null };
    });
    await receiver.onDeploy();
    await receiver.onStart();

    const first = 'MSH|^~\\&|A||||||ADT^A01|FIRST|P|2.5.1';
    const second = 'MSH|^~\\&|A||||||ADT^A01|SECOND|P|2.5.1';
    const combined = Buffer.concat([wrapMllp(first), wrapMllp(second)]);

    const responses: string[] = [];
    await new Promise<void>((resolve) => {
      const client = net.createConnection({ host: '127.0.0.1', port: TEST_PORT }, () => {
        client.write(combined);
      });
      const parser = new MllpParser();
      client.on('data', (chunk: Buffer) => {
        responses.push(...parser.parse(chunk));
        if (responses.length >= 2) { client.end(); resolve(); }
      });
    });

    expect(order).toEqual([first, second]);
    expect(responses[0]).toContain('MSA|AA|FIRST');
    expect(responses[1]).toContain('MSA|AA|SECOND');
  });

  it('accepts TLS connections and returns an ACK', async () => {
    receiver = new TcpMllpReceiver(makeConfig({ tls: { cert: TEST_CERT_PEM, key: TEST_KEY_PEM } }));
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1 })));
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await connectAndSendTls(TEST_PORT, VALID_HL7);

    expect(response).toContain('MSA|AA|MSGID123');
  });

  it('rejects and destroys a connection that exceeds max frame size (no crash)', async () => {
    const { logger, errors } = makeLogger();
    receiver = new TcpMllpReceiver(makeConfig({ maxFrameBytes: 1024 }), logger);
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    // Send an unterminated frame larger than the cap.
    const closed = await new Promise<boolean>((resolve) => {
      const client = net.createConnection({ host: '127.0.0.1', port: TEST_PORT }, () => {
        client.write(Buffer.concat([Buffer.from([0x0b]), Buffer.alloc(2048, 0x41)]));
      });
      client.on('close', () => resolve(true));
      client.on('error', () => { /* connection reset is acceptable */ });
      setTimeout(() => resolve(false), 3_000);
    });

    expect(closed).toBe(true);
    expect(errors.some((e) => e.msg.includes('frame rejected'))).toBe(true);
  });
});
