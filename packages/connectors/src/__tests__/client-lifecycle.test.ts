import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectFresh, closeQuietly } from '../client-lifecycle.js';
import { makeMockLogger } from '../__fixtures__/mock-logger.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connectFresh', () => {
  it('returns the client once it connects', async () => {
    const client = { connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) };
    await expect(connectFresh(client, 1_000, 'X connect')).resolves.toBe(client);
    expect(client.connect).toHaveBeenCalledOnce();
  });

  it('rejects with the connect error', async () => {
    const client = { connect: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('refused')) };
    await expect(connectFresh(client, 1_000, 'X connect')).rejects.toThrow('refused');
  });

  it('rejects with the label when connect exceeds the timeout', async () => {
    const client = { connect: (): Promise<void> => new Promise(() => { /* never */ }) };
    const pending = connectFresh(client, 1_000, 'X connect');
    const assertion = expect(pending).rejects.toThrow('X connect timed out after 1000ms');
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('closes a client whose connect failed, and still rejects with the connect error', async () => {
    const client = { connect: vi.fn<() => Promise<void>>().mockRejectedValue(new Error('refused')) };
    const close = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('not connected'));
    await expect(connectFresh(client, 1_000, 'X connect', close)).rejects.toThrow('refused');
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes a client whose connect timed out, so a late login does not leave a session open', async () => {
    const client = { connect: (): Promise<void> => new Promise(() => { /* never */ }) };
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const pending = connectFresh(client, 1_000, 'X connect', close);
    const assertion = expect(pending).rejects.toThrow('X connect timed out after 1000ms');
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('closeQuietly', () => {
  it('closes without logging when close succeeds', async () => {
    const { logger, warnings } = makeMockLogger();
    const close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    await closeQuietly({ close, timeoutMs: 1_000, label: 'X end', logger, message: 'Error closing X' });
    expect(close).toHaveBeenCalledOnce();
    expect(warnings).toHaveLength(0);
  });

  it('swallows a close error and logs it as a warning', async () => {
    const { logger, warnings } = makeMockLogger();
    const close = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('socket gone'));
    await expect(
      closeQuietly({ close, timeoutMs: 1_000, label: 'X end', logger, message: 'Error closing X' }),
    ).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.msg).toBe('Error closing X');
    expect(warnings[0]?.obj['errMsg']).toBe('socket gone');
  });

  it('logs a timeout when close hangs', async () => {
    const { logger, warnings } = makeMockLogger();
    const close = (): Promise<void> => new Promise(() => { /* never */ });
    const pending = closeQuietly({ close, timeoutMs: 1_000, label: 'X end', logger, message: 'Error closing X' });
    await vi.advanceTimersByTimeAsync(1_000);
    await pending;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.obj['errMsg']).toBe('X end timed out after 1000ms');
  });
});
