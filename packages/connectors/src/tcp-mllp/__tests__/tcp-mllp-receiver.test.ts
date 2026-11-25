import { describe, it, expect, afterEach, vi } from 'vitest';
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
import { stderr, type Result } from '@galvanigraph/core-util';
import { TEST_CERT_PEM, TEST_KEY_PEM } from '../../__fixtures__/tls-certs.js';
import { freePort } from '../../__fixtures__/free-port.js';

const TEST_PORT = await freePort();

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

function failingDispatcher(): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async () => ({ ok: false as const, value: null, error: stderr('pipeline boom') });
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

let receiver: TcpMllpReceiver | null = null;

afterEach(async () => {
  if (receiver) {
    await receiver.onStop();
    await receiver.onUndeploy();
    receiver = null;
  }
});

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
          client.write(wrapMllp('MSG2'));
        }
        if (responses.length >= 2) {
          client.end();
          resolve();
        }
      });
    });

    expect(received).toEqual(['MSG1', 'MSG2']);
    expect(responses).toHaveLength(2);
    for (const r of responses) expect(r).toContain('MSA|AA');
  });

  it('answers every frame of one write that together pass maxFrameBytes (#415)', async () => {
    const received: string[] = [];
    receiver = new TcpMllpReceiver(makeConfig({ maxFrameBytes: 1_000 }));
    receiver.setDispatcher(makeDispatcher((raw) => {
      received.push(raw.content);
      return { messageId: received.length };
    }));
    await receiver.onDeploy();
    await receiver.onStart();
    const texts = ['A', 'B', 'C'].map((c) => `${VALID_HL7}\rNTE|1||${c.repeat(350)}`);

    const acks = await new Promise<readonly string[]>((resolve, reject) => {
      const parser = new MllpParser();
      const answers: string[] = [];
      const client = net.createConnection({ host: '127.0.0.1', port: TEST_PORT }, () => {
        client.write(Buffer.concat(texts.map((text) => wrapMllp(text))));
      });
      client.on('data', (chunk: Buffer) => {
        answers.push(...parser.parse(chunk));
        if (answers.length === texts.length) client.end();
      });
      client.on('error', reject);
      client.on('close', () => { resolve(answers); });
    });

    expect(received).toEqual(texts);
    expect(acks).toHaveLength(3);
  });

  it('halt destroys connections immediately', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

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

  it('acknowledges a filtered message with AA: it was received and deliberately not routed', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 1, status: DISPATCH_STATUS.FILTERED })));
    await receiver.onDeploy();
    await receiver.onStart();

    const response = await connectAndSend(TEST_PORT, VALID_HL7);

    expect(response).toContain('MSA|AA|MSGID123');
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

describe('TcpMllpReceiver answer charset (#415)', () => {
  it('answers with the ACK when the charset cannot hold the response, and logs it without the response', async () => {
    const { logger, errors } = makeLogger();
    receiver = new TcpMllpReceiver(makeConfig({ charset: 'latin1', responseMode: MLLP_RESPONSE_MODE.PASSTHROUGH }), logger);
    receiver.setDispatcher(makeDispatcher(() => ({ messageId: 7, response: 'MSH|^~\\&|DO\u010dEK' })));
    await receiver.onDeploy();
    await receiver.onStart();

    const answer = await connectAndSend(TEST_PORT, VALID_HL7);

    expect(answer).toContain('MSA|AA|MSGID123');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.msg).toContain('sending an ACK or NAK instead');
    expect(JSON.stringify(errors[0])).not.toContain('EK');
  });
});

describe('TcpMllpReceiver ACK of a message whose delimiters are not characters', () => {
  it('answers, or the sender would send a recorded message again', async () => {
    const { logger, errors } = makeLogger();
    receiver = new TcpMllpReceiver(makeConfig(), logger);
    receiver.setDispatcher(makeDispatcher());
    await receiver.onDeploy();
    await receiver.onStart();

    // The field separator is half of a surrogate pair, which UTF-8 cannot hold.
    const answer = await connectAndSend(TEST_PORT, 'MSH\ud83d\ude00^~\\&\ud83d\ude00A\ud83d\ude00B');

    expect(answer).toContain('AA');
    expect(errors).toEqual([]);
  });
});

describe('TcpMllpReceiver stop', () => {
  /** Open a connection that stays open, as real HL7 senders do. */
  async function openPersistent(port: number): Promise<{ client: net.Socket; acks: string[]; closed: Promise<void> }> {
    const acks: string[] = [];
    const parser = new MllpParser();
    const client = net.createConnection({ host: '127.0.0.1', port });
    client.on('data', (chunk: Buffer) => { acks.push(...parser.parse(chunk)); });
    client.on('error', () => { /* a reset during stop is expected */ });
    const closed = new Promise<void>((resolve) => { client.once('close', () => { resolve(); }); });
    await new Promise<void>((resolve) => { client.once('connect', () => { resolve(); }); });
    return { client, acks, closed };
  }

  it('stops promptly while a sender keeps its connection open', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    const { client, closed } = await openPersistent(TEST_PORT);

    const started = Date.now();
    const result = await receiver.onStop();

    expect(result.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
    await closed;
    client.destroy();
  });

  it('accepts no message once stop has been requested', async () => {
    const received: string[] = [];
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher((raw) => { received.push(raw.content); return { messageId: 1 }; }));
    await receiver.onStart();
    const { client, acks, closed } = await openPersistent(TEST_PORT);

    const stopping = receiver.onStop();
    client.write(wrapMllp(VALID_HL7));
    await stopping;
    await closed;

    // Not dispatched and not acknowledged, so the sender keeps the message and resends it.
    expect(received).toEqual([]);
    expect(acks).toEqual([]);
  });

  it('finishes and acknowledges the message in flight before it stops', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let dispatched!: () => void;
    const entered = new Promise<void>((resolve) => { dispatched = resolve; });
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(async () => {
      dispatched();
      await gate;
      return { ok: true as const, value: { messageId: 1 }, error: null };
    });
    await receiver.onStart();
    const { client, acks, closed } = await openPersistent(TEST_PORT);
    client.write(wrapMllp(VALID_HL7));
    await entered;

    let stopped = false;
    const stopping = receiver.onStop().then(() => { stopped = true; });
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    expect(stopped).toBe(false);

    release();
    await stopping;
    await closed;

    expect(acks).toHaveLength(1);
    expect(acks[0]).toContain('MSA|AA|MSGID123');
  });

  const hl7 = (controlId: string): string => VALID_HL7.replace('MSGID123', controlId);

  /** A dispatcher that holds each message until it is let go, and what it was given. */
  function heldDispatcher(): { dispatch: (raw: RawMessage) => Promise<Result<DispatchResult>>; received: string[]; letGo: () => void; entered: Promise<void> } {
    let letGo = (): void => undefined;
    let enter = (): void => undefined;
    const gate = new Promise<void>((resolve) => { letGo = resolve; });
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const received: string[] = [];
    return {
      received,
      letGo: () => { letGo(); },
      entered,
      dispatch: async (raw) => {
        received.push(raw.content);
        enter();
        await gate;
        return { ok: true as const, value: { messageId: received.length }, error: null };
      },
    };
  }

  it('answers a message that takes longer than 5 seconds, so its sender does not send it again (#413)', async () => {
    const { dispatch, letGo, entered } = heldDispatcher();
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const { client, acks, closed } = await openPersistent(TEST_PORT);
    client.write(wrapMllp(VALID_HL7));
    await entered;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let stopped = false;
      const stopping = receiver.onStop().then(() => { stopped = true; });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(stopped).toBe(false);
      letGo();
      await stopping;
    } finally {
      vi.useRealTimers();
    }
    await closed;

    expect(acks).toHaveLength(1);
    expect(acks[0]).toContain('MSA|AA|MSGID123');
  });

  it('dispatches no message that waits behind the one in hand once it is stopped (#413)', async () => {
    const { dispatch, received, letGo, entered } = heldDispatcher();
    const warnings: unknown[] = [];
    receiver = new TcpMllpReceiver(makeConfig(), { ...makeLogger().logger, warn: (obj: unknown): void => { warnings.push(obj); } });
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const { client, acks, closed } = await openPersistent(TEST_PORT);
    client.write(Buffer.concat(['A', 'B', 'C'].map((id) => wrapMllp(hl7(id)))));
    await entered;

    const stopping = receiver.onStop();
    letGo();
    await stopping;
    await closed;

    expect(received).toEqual([hl7('A')]);
    expect(warnings).toEqual([expect.objectContaining({ messages: 2 })]);
    // B and C got no answer, so their sender keeps them.
    expect(acks).toHaveLength(1);
    expect(acks[0]).toContain('MSA|AA|A');
  });

  it('answers the message in hand although another arrives on its connection after the stop (#413)', async () => {
    const { dispatch, received, letGo, entered } = heldDispatcher();
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const { client, acks, closed } = await openPersistent(TEST_PORT);
    client.write(wrapMllp(hl7('A')));
    await entered;

    const stopping = receiver.onStop();
    await new Promise<void>((resolve) => { client.write(wrapMllp(hl7('B')), () => { resolve(); }); });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    letGo();
    await stopping;
    await closed;

    expect(received).toEqual([hl7('A')]);
    expect(acks).toHaveLength(1);
    expect(acks[0]).toContain('MSA|AA|A');
  });

  /** The sender has the first bytes of its next message sent before it reads what it was answered. */
  async function stopWhileSending(client: net.Socket, acks: string[], closed: Promise<void>, stop: () => Promise<unknown>): Promise<void> {
    client.pause();
    client.write(wrapMllp(hl7('B')).subarray(0, 20));
    const stopping = stop();
    const sending = setInterval(() => { client.write('PID|1\r'); }, 20);
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    clearInterval(sending);
    expect(acks).toEqual([]);
    client.resume();
    await Promise.all([stopping, closed]);
  }

  it('the answer reaches a sender that goes on sending and reads it late', async () => {
    const { dispatch, letGo, entered } = heldDispatcher();
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const { client, acks, closed } = await openPersistent(TEST_PORT);
    client.write(wrapMllp(hl7('A')));
    await entered;

    await stopWhileSending(client, acks, closed, () => {
      const stopping = receiver!.onStop();
      letGo();
      return stopping;
    });

    expect(acks).toHaveLength(1);
    expect(acks[0]).toContain('MSA|AA|A');
  });

  it('an answer written just before the stop reaches its sender too', async () => {
    let answered = (): void => undefined;
    const written = new Promise<void>((resolve) => { answered = resolve; });
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(async () => {
      // Once the answer is written, which comes after this in the same turn.
      setImmediate(() => { answered(); });
      return { ok: true as const, value: { messageId: 1 }, error: null };
    });
    await receiver.onStart();
    const { client, acks, closed } = await openPersistent(TEST_PORT);
    client.pause();
    client.write(wrapMllp(hl7('A')));
    await written;

    await stopWhileSending(client, acks, closed, () => receiver!.onStop());

    expect(acks).toHaveLength(1);
    expect(acks[0]).toContain('MSA|AA|A');
  });

  it('gives up an answer that is not read within 15 seconds', async () => {
    const { dispatch, letGo, entered } = heldDispatcher();
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const { client } = await openPersistent(TEST_PORT);
    client.write(wrapMllp(VALID_HL7));
    await entered;

    // As a socket whose peer reads nothing: its last write never finishes.
    const end = vi.spyOn(net.Socket.prototype, 'end').mockReturnThis();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const stopping = receiver.onStop();
      letGo();
      await vi.waitFor(() => { expect(end).toHaveBeenCalled(); });
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await stopping).ok).toBe(true);
    } finally {
      vi.useRealTimers();
      end.mockRestore();
      client.destroy();
    }
  });

  it('does not close a connection as idle while its message is being processed, and does once it waits for the next', async () => {
    const { dispatch, letGo, entered } = heldDispatcher();
    const setTimeoutOf = net.Socket.prototype.setTimeout;
    const shortened = vi.spyOn(net.Socket.prototype, 'setTimeout').mockImplementation(function (this: net.Socket, ms: number) {
      return setTimeoutOf.call(this, ms === 300_000 ? 100 : ms);
    });
    try {
      receiver = new TcpMllpReceiver(makeConfig(), makeLogger().logger);
      receiver.setDispatcher(dispatch);
      await receiver.onStart();
      const { client, acks, closed } = await openPersistent(TEST_PORT);
      client.write(wrapMllp(VALID_HL7));
      await entered;

      await new Promise((resolve) => { setTimeout(resolve, 300); });
      letGo();
      await closed;

      expect(acks).toHaveLength(1);
      expect(acks[0]).toContain('MSA|AA|MSGID123');
    } finally {
      shortened.mockRestore();
    }
  });

  it('closes a connection that waits for nothing at once, while another has a message in hand', async () => {
    const { dispatch, letGo, entered } = heldDispatcher();
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const busy = await openPersistent(TEST_PORT);
    const idle = await openPersistent(TEST_PORT);
    busy.client.write(wrapMllp(VALID_HL7));
    await entered;

    const stopping = receiver.onStop();
    await idle.closed;
    letGo();
    await stopping;
    await busy.closed;

    expect(busy.acks).toHaveLength(1);
  });

  it('waits for a message whose sender has gone, or its destinations would stop under it', async () => {
    const { dispatch, letGo, entered } = heldDispatcher();
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const { client, closed } = await openPersistent(TEST_PORT);
    client.write(wrapMllp(VALID_HL7));
    await entered;
    client.destroy();
    await closed;
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    let stopped = false;
    const stopping = receiver.onStop().then(() => { stopped = true; });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(stopped).toBe(false);
    letGo();
    await stopping;
  });

  it('a second stop waits as the first does', async () => {
    const { dispatch, letGo, entered } = heldDispatcher();
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const { client } = await openPersistent(TEST_PORT);
    client.write(wrapMllp(VALID_HL7));
    await entered;

    const ended: string[] = [];
    const first = receiver.onStop().then(() => { ended.push('first'); });
    const second = receiver.onStop().then(() => { ended.push('second'); });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(ended).toEqual([]);
    letGo();
    await Promise.all([first, second]);
  });

  it('a halt ends a stop that waits, and nothing that waited is dispatched, not even after the next start (#413)', async () => {
    const { dispatch, received, letGo, entered } = heldDispatcher();
    receiver = new TcpMllpReceiver(makeConfig(), makeLogger().logger);
    receiver.setDispatcher(dispatch);
    await receiver.onStart();
    const { client, acks, closed } = await openPersistent(TEST_PORT);
    client.write(Buffer.concat(['A', 'B'].map((id) => wrapMllp(hl7(id)))));
    await entered;

    const stopping = receiver.onStop();
    expect((await receiver.onHalt()).ok).toBe(true);
    await stopping;
    await closed;
    expect((await receiver.onStart()).ok).toBe(true);
    letGo();
    expect(await connectAndSend(TEST_PORT, hl7('C'))).toContain('MSA|AA|C');

    expect(received).toEqual([hl7('A'), hl7('C')]);
    expect(acks).toEqual([]);
  });

  it('stops promptly while a sender stalls in its TLS handshake', async () => {
    receiver = new TcpMllpReceiver(makeConfig({ tls: { cert: TEST_CERT_PEM, key: TEST_KEY_PEM } }));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    const { closed } = await openPersistent(TEST_PORT);

    const stopped = receiver.onStop();
    await closed;
    expect((await stopped).ok).toBe(true);
  });

  it('refuses new connections after stop', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    await receiver.onStop();

    await expect(connectAndSend(TEST_PORT, VALID_HL7)).rejects.toThrow();
  });

  it('can be started again after a stop', async () => {
    receiver = new TcpMllpReceiver(makeConfig());
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();
    const first = await openPersistent(TEST_PORT);
    await receiver.onStop();
    await first.closed;

    expect((await receiver.onStart()).ok).toBe(true);
    expect(await connectAndSend(TEST_PORT, VALID_HL7)).toContain('MSA|AA|MSGID123');
  });
});
