import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import { stderr, type Result } from '@galvanigraph/core-util';
import {
  EmailReceiver,
  EMAIL_PROTOCOL,
  EMAIL_POST_ACTION,
  type EmailReceiverConfig,
  type ImapClientFactory,
} from '../email-receiver.js';
import {
  DISPATCHED_KEYWORD,
  ERROR_KEYWORD,
  hasDispatchedKeyword,
  hasErrorKeyword,
  ImapRefusal,
  type ImapClient,
  type EmailMessage,
} from '../imap-client.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

function makeConfig(overrides?: Partial<EmailReceiverConfig>): EmailReceiverConfig {
  return {
    host: 'mail.example.com',
    port: 993,
    secure: true,
    username: 'user@example.com',
    password: 'secret',
    protocol: EMAIL_PROTOCOL.IMAP,
    folder: 'INBOX',
    pollingIntervalMs: 5_000,
    postAction: EMAIL_POST_ACTION.MARK_READ,
    moveToFolder: '',
    subjectFilter: '',
    ...overrides,
  };
}

function makeMessage({ body = 'MSH|^~\\&|SENDER|HOSPITAL', ...overrides }: Partial<EmailMessage> & { readonly body?: string } = {}): EmailMessage {
  return {
    uid: 1,
    uidValidity: '1',
    subject: 'Lab Results',
    from: 'sender@hospital.org',
    to: 'receiver@clinic.org',
    date: '2026-01-15T10:30:00.000Z',
    source: Buffer.from(body),
    attachmentCount: 0,
    dispatched: false,
    held: false,
    ...overrides,
  };
}

function makeMockClient(messages: readonly EmailMessage[] = []): ImapClient {
  return {
    connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    fetchUnread: vi.fn<(folder: string) => Promise<readonly EmailMessage[]>>().mockResolvedValue(messages),
    markRead: vi.fn<(uid: number) => Promise<void>>().mockResolvedValue(undefined),
    mark: vi.fn<(uid: number, keyword: string) => Promise<boolean>>().mockResolvedValue(true),
    moveMessage: vi.fn<(uid: number, folder: string) => Promise<void>>().mockResolvedValue(undefined),
    deleteMessage: vi.fn<(uid: number) => Promise<void>>().mockResolvedValue(undefined),
    disconnect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    destroy: vi.fn<() => void>(),
  };
}

function makeClientFactory(client: ImapClient): ImapClientFactory {
  return (): ImapClient => client;
}

function makeDispatcher(
  handler?: (raw: RawMessage) => DispatchResult,
): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async (raw) => ({
    ok: true as const,
    value: handler
      ? handler(raw)
      : { messageId: 1 },
    error: null,
  });
}

function makeFailDispatcher(): (raw: RawMessage) => Promise<Result<DispatchResult>> {
  return async () => ({
    ok: false as const,
    value: null,
    error: stderr({ name: 'Error', code: 'DISPATCH_FAILED', message: 'dispatch failed' }),
  });
}

let receiver: EmailReceiver | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  if (receiver) {
    await receiver.onStop();
    await receiver.onUndeploy();
    receiver = null;
  }
});

describe('EmailReceiver', () => {
  describe('onDeploy', () => {
    it('validates host is required', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig({ host: '' }), makeClientFactory(client));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates port range', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig({ port: 0 }), makeClientFactory(client));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates port upper bound', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig({ port: 70000 }), makeClientFactory(client));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates username is required', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig({ username: '' }), makeClientFactory(client));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates password is required', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig({ password: '' }), makeClientFactory(client));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates folder is required', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig({ folder: '' }), makeClientFactory(client));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates polling interval minimum', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig({ pollingIntervalMs: 500 }), makeClientFactory(client));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates moveToFolder required when postAction is MOVE', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(
        makeConfig({ postAction: EMAIL_POST_ACTION.MOVE, moveToFolder: '' }),
        makeClientFactory(client),
      );
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('deploys with valid config', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      const result = await receiver.onDeploy();
      expect(result.ok).toBe(true);
    });
  });

  describe('onStart', () => {
    it('errors if dispatcher not set', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      const result = await receiver.onStart();
      expect(result.ok).toBe(false);
    });

    it('starts successfully with dispatcher set', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());
      const result = await receiver.onStart();
      expect(result.ok).toBe(true);
      expect(client.connect).toHaveBeenCalledOnce();
    });
  });

  describe('poll cycle', () => {
    it('fetches unread messages and dispatches them', async () => {
      const captured: RawMessage[] = [];
      const messages = [
        makeMessage({ uid: 1, subject: 'Lab Results' }),
        makeMessage({ uid: 2, subject: 'Radiology Report' }),
      ];
      const client = makeMockClient(messages);

      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: captured.length };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(2);
      expect(client.fetchUnread).toHaveBeenCalledWith('INBOX');
    });

    it('uses configured folder for fetching', async () => {
      const client = makeMockClient([]);

      receiver = new EmailReceiver(makeConfig({ folder: 'HL7' }), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.fetchUnread).toHaveBeenCalledWith('HL7');
    });

    it('sets content to email body', async () => {
      let capturedRaw: RawMessage | null = null;
      const msg = makeMessage({ body: 'MSH|^~\\&|SENDER|HOSPITAL' });
      const client = makeMockClient([msg]);

      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher((raw) => {
        capturedRaw = raw;
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(capturedRaw).not.toBeNull();
      expect(capturedRaw!.content).toBe('MSH|^~\\&|SENDER|HOSPITAL');
    });

    it('includes email metadata in sourceMap', async () => {
      let capturedRaw: RawMessage | null = null;
      const msg = makeMessage({
        subject: 'ORU Result',
        from: 'lab@hospital.org',
        to: 'ehr@clinic.org',
        date: '2026-01-15T10:30:00.000Z',
        attachmentCount: 3,
      });
      const client = makeMockClient([msg]);

      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher((raw) => {
        capturedRaw = raw;
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(capturedRaw).not.toBeNull();
      expect(capturedRaw!.sourceMap['subject']).toBe('ORU Result');
      expect(capturedRaw!.sourceMap['from']).toBe('lab@hospital.org');
      expect(capturedRaw!.sourceMap['to']).toBe('ehr@clinic.org');
      expect(capturedRaw!.sourceMap['date']).toBe('2026-01-15T10:30:00.000Z');
      expect(capturedRaw!.sourceMap['attachmentCount']).toBe(3);
    });
  });

  describe('subject filter', () => {
    it('only processes messages matching subject filter', async () => {
      const captured: RawMessage[] = [];
      const messages = [
        makeMessage({ uid: 1, subject: 'HL7 Lab Results' }),
        makeMessage({ uid: 2, subject: 'Meeting Invite' }),
        makeMessage({ uid: 3, subject: 'HL7 Radiology' }),
      ];
      const client = makeMockClient(messages);

      receiver = new EmailReceiver(
        makeConfig({ subjectFilter: 'HL7' }),
        makeClientFactory(client),
      );
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: captured.length };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(2);
      expect(captured[0]!.sourceMap['subject']).toBe('HL7 Lab Results');
      expect(captured[1]!.sourceMap['subject']).toBe('HL7 Radiology');
    });

    it('subject filter is case insensitive', async () => {
      const captured: RawMessage[] = [];
      const messages = [
        makeMessage({ uid: 1, subject: 'hl7 results' }),
      ];
      const client = makeMockClient(messages);

      receiver = new EmailReceiver(
        makeConfig({ subjectFilter: 'HL7' }),
        makeClientFactory(client),
      );
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(1);
    });

    it('processes all messages when no subject filter', async () => {
      const captured: RawMessage[] = [];
      const messages = [
        makeMessage({ uid: 1, subject: 'Anything' }),
        makeMessage({ uid: 2, subject: 'Everything' }),
      ];
      const client = makeMockClient(messages);

      receiver = new EmailReceiver(
        makeConfig({ subjectFilter: '' }),
        makeClientFactory(client),
      );
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: captured.length };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(captured).toHaveLength(2);
    });
  });

  describe('post-action: DELETE', () => {
    it('deletes message after successful dispatch', async () => {
      const msg = makeMessage({ uid: 42 });
      const client = makeMockClient([msg]);

      receiver = new EmailReceiver(
        makeConfig({ postAction: EMAIL_POST_ACTION.DELETE }),
        makeClientFactory(client),
      );
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.deleteMessage).toHaveBeenCalledWith(42);
    });
  });

  describe('post-action: MARK_READ', () => {
    it('marks message as read after successful dispatch', async () => {
      const msg = makeMessage({ uid: 7 });
      const client = makeMockClient([msg]);

      receiver = new EmailReceiver(
        makeConfig({ postAction: EMAIL_POST_ACTION.MARK_READ }),
        makeClientFactory(client),
      );
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.markRead).toHaveBeenCalledWith(7);
    });
  });

  describe('post-action: MOVE', () => {
    it('moves message to target folder after successful dispatch', async () => {
      const msg = makeMessage({ uid: 15 });
      const client = makeMockClient([msg]);

      receiver = new EmailReceiver(
        makeConfig({
          postAction: EMAIL_POST_ACTION.MOVE,
          moveToFolder: 'Processed',
        }),
        makeClientFactory(client),
      );
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.moveMessage).toHaveBeenCalledWith(15, 'Processed');
    });
  });

  describe('post-action: skipped on dispatch failure', () => {
    it('does not apply post-action when dispatch fails', async () => {
      const msg = makeMessage({ uid: 99 });
      const client = makeMockClient([msg]);

      receiver = new EmailReceiver(
        makeConfig({ postAction: EMAIL_POST_ACTION.DELETE }),
        makeClientFactory(client),
      );
      receiver.setDispatcher(makeFailDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.deleteMessage).not.toHaveBeenCalled();
      expect(client.markRead).not.toHaveBeenCalled();
      expect(client.moveMessage).not.toHaveBeenCalled();
    });
  });

  describe('post-action failure', () => {
    it('retries only the post-action, never dispatching the same email twice', async () => {
      const msg = makeMessage({ uid: 7 });
      const client = makeMockClient([msg]);
      vi.mocked(client.markRead)
        .mockRejectedValueOnce(new ImapRefusal('IMAP STORE failed'))
        .mockResolvedValue(undefined);
      const dispatched: RawMessage[] = [];
      const { logger, errors } = makeMockLogger();

      receiver = new EmailReceiver(makeConfig({ postAction: EMAIL_POST_ACTION.MARK_READ }), makeClientFactory(client), logger);
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw); return { messageId: 1 }; }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatched).toHaveLength(1);
      expect(client.markRead).toHaveBeenCalledTimes(2);
      expect(errors.some((e) => e.msg.includes('post-action failed'))).toBe(true);
    });

    it('logs a dispatch failure and leaves the email for retry', async () => {
      const client = makeMockClient([makeMessage({ uid: 8 })]);
      const { logger, errors } = makeMockLogger();

      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client), logger);
      receiver.setDispatcher(makeFailDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(errors.some((e) => e.msg.includes('dispatch failed'))).toBe(true);
      expect(client.markRead).not.toHaveBeenCalled();
    });

    it('keeps processing the rest of the cycle and the client when one email throws', async () => {
      const client = makeMockClient([makeMessage({ uid: 1 }), makeMessage({ uid: 2, body: 'second' })]);
      const dispatched: string[] = [];
      const { logger, errors } = makeMockLogger();

      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client), logger);
      receiver.setDispatcher(async (raw) => {
        if (raw.content !== 'second') throw new Error('dispatcher blew up');
        dispatched.push(raw.content);
        return { ok: true as const, value: { messageId: 2 }, error: null };
      });
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatched).toEqual(['second']);
      expect(client.markRead).toHaveBeenCalledWith(2);
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(errors.some((e) => e.msg.includes('dispatch failed') && e.obj['uid'] === 1)).toBe(true);
    });
  });

  describe('connection error handling', () => {
    it('continues polling after fetch error', async () => {
      const captured: RawMessage[] = [];
      const msg = makeMessage({ uid: 1 });
      const client = makeMockClient([]);

      let callCount = 0;
      vi.mocked(client.fetchUnread).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Connection lost');
        return [msg];
      });

      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher((raw) => {
        captured.push(raw);
        return { messageId: 1 };
      }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(captured).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(captured).toHaveLength(1);
    });

    it('returns error when connect fails on start', async () => {
      const client = makeMockClient();
      vi.mocked(client.connect).mockRejectedValue(new Error('Connection refused'));

      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());
      const result = await receiver.onStart();
      expect(result.ok).toBe(false);
    });

    it('closes a client whose connect failed on start and does not keep it, so stop does not log it out again', async () => {
      const client = makeMockClient();
      vi.mocked(client.connect).mockRejectedValue(new Error('Connection refused'));
      // Logging out a session that never connected fails.
      vi.mocked(client.disconnect).mockRejectedValue(new Error('Not connected'));

      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());
      expect((await receiver.onStart()).ok).toBe(false);
      // The failed connect is cleaned up once (its error ignored), in case the library logs in late.
      expect(client.disconnect).toHaveBeenCalledTimes(1);

      const stopResult = await receiver.onStop();
      expect(stopResult.ok).toBe(true);
      expect(client.disconnect).toHaveBeenCalledTimes(1);
    });

    it('does not log out an already stopped session again when a restart fails', async () => {
      const first = makeMockClient();
      const second = makeMockClient();
      vi.mocked(second.connect).mockRejectedValue(new Error('Connection refused'));
      const clients = [first, second];
      let next = 0;
      receiver = new EmailReceiver(makeConfig(), () => clients[next++] ?? second);
      receiver.setDispatcher(makeDispatcher());

      expect((await receiver.onStart()).ok).toBe(true);
      expect((await receiver.onStop()).ok).toBe(true);
      // A second logout of the closed session would fail.
      vi.mocked(first.disconnect).mockRejectedValue(new Error('Not connected'));

      expect((await receiver.onStart()).ok).toBe(false);
      expect((await receiver.onStop()).ok).toBe(true);
      expect(first.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  // Pause is onStop then onStart on the same instance.
  describe('stopping during a dispatch', () => {
    function pendingDispatcher(): {
      readonly dispatcher: (raw: RawMessage) => Promise<Result<DispatchResult>>;
      readonly calls: () => number;
      readonly release: () => void;
    } {
      let calls = 0;
      let release = (): void => undefined;
      const dispatcher = (): Promise<Result<DispatchResult>> => {
        calls++;
        if (calls > 1) return Promise.resolve({ ok: true as const, value: { messageId: calls }, error: null });
        return new Promise((resolve) => {
          release = (): void => { resolve({ ok: true as const, value: { messageId: 1 }, error: null }); };
        });
      };
      return { dispatcher, calls: () => calls, release: () => { release(); } };
    }

    it('stop waits for the dispatch in flight, so the email is post-processed and not dispatched again', async () => {
      const client = makeMockClient([makeMessage({ uid: 7 })]);
      const pending = pendingDispatcher();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(pending.dispatcher);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(pending.calls()).toBe(1);

      const stopping = receiver.onStop();
      pending.release();
      expect((await stopping).ok).toBe(true);
      expect(client.markRead).toHaveBeenCalledWith(7);

      // Resume: the server would no longer list it as unread.
      vi.mocked(client.fetchUnread).mockResolvedValue([]);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(pending.calls()).toBe(1);
    });

    it('a stop waits for the dispatch however long it takes, and takes no email after it (#413)', async () => {
      const client = makeMockClient([makeMessage({ uid: 7 }), makeMessage({ uid: 8 })]);
      const pending = pendingDispatcher();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(pending.dispatcher);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      let stopped = false;
      const stopping = receiver.onStop().then(() => { stopped = true; });
      await vi.advanceTimersByTimeAsync(600_000);
      expect(stopped).toBe(false);
      pending.release();
      await stopping;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(pending.calls()).toBe(1);
      expect(client.markRead).toHaveBeenCalledExactlyOnceWith(7);
      expect(client.disconnect).toHaveBeenCalledOnce();
    });

    it('a stop during a fetch dispatches nothing of what it brings (#413)', async () => {
      const client = makeMockClient();
      let fetched = (emails: readonly EmailMessage[]): void => { void emails; };
      vi.mocked(client.fetchUnread).mockReturnValue(new Promise((resolve) => { fetched = resolve; }));
      const pending = pendingDispatcher();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(pending.dispatcher);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect((await receiver.onStop()).ok).toBe(true);
      fetched([makeMessage()]);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(pending.calls()).toBe(0);
      expect(client.disconnect).toHaveBeenCalledOnce();
    });

    it('a halt does not wait, takes no email after it, and the one in hand is marked and closed when its message has ended', async () => {
      const client = makeMockClient([makeMessage({ uid: 8 }), makeMessage({ uid: 9 })]);
      const resumed = makeMockClient([makeMessage({ uid: 9 })]);
      const clients = [client, resumed];
      const pending = pendingDispatcher();
      receiver = new EmailReceiver(makeConfig(), () => clients.shift()!);
      receiver.setDispatcher(pending.dispatcher);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect((await receiver.onHalt()).ok).toBe(true);
      expect(client.destroy).not.toHaveBeenCalled();
      await receiver.onStart();
      pending.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.mark).toHaveBeenCalledExactlyOnceWith(8, DISPATCHED_KEYWORD);
      expect(client.markRead).toHaveBeenCalledExactlyOnceWith(8);
      expect(client.disconnect).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(pending.calls()).toBe(2);
      expect(resumed.markRead).toHaveBeenCalledExactlyOnceWith(9);
    });

    it('a stop waits for an email that an earlier halt left in hand, and a halt ends that too', async () => {
      const first = makeMockClient([makeMessage({ uid: 8 })]);
      const second = makeMockClient();
      const clients = [first, second];
      const pending = pendingDispatcher();
      receiver = new EmailReceiver(makeConfig(), () => clients.shift()!);
      receiver.setDispatcher(pending.dispatcher);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);
      await receiver.onHalt();
      await receiver.onStart();

      let stopped = false;
      const stopping = receiver.onStop().then(() => { stopped = true; });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(stopped).toBe(false);
      await receiver.onHalt();
      await stopping;
      expect(second.destroy).toHaveBeenCalledOnce();
      pending.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(first.markRead).toHaveBeenCalledExactlyOnceWith(8);
      expect(first.disconnect).toHaveBeenCalledOnce();
      expect(second.markRead).not.toHaveBeenCalled();
    });

    it('a halt ends a stop that waits, and the email in hand is still marked and post-processed on its connection', async () => {
      const client = makeMockClient([makeMessage({ uid: 8 })]);
      const calls: string[] = [];
      vi.mocked(client.mark).mockImplementation(async () => { calls.push('mark'); return true; });
      vi.mocked(client.markRead).mockImplementation(async () => { calls.push('markRead'); });
      vi.mocked(client.disconnect).mockImplementation(async () => { calls.push('disconnect'); });
      vi.mocked(client.destroy).mockImplementation(() => { calls.push('destroy'); });
      const pending = pendingDispatcher();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(pending.dispatcher);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      const stopping = receiver.onStop();
      await receiver.onHalt();
      expect((await stopping).ok).toBe(true);
      expect(calls).toEqual([]);
      pending.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toEqual(['mark', 'markRead', 'disconnect']);
    });

    it('a halt ends a stop whose logout the server does not answer', async () => {
      const client = makeMockClient();
      vi.mocked(client.disconnect).mockReturnValue(new Promise(() => { /* never */ }));
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client), makeMockLogger().logger);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      const stopping = receiver.onStop();
      await receiver.onHalt();

      expect((await stopping).ok).toBe(true);
      receiver = null;
    });

    it('fetches nothing over a connection that opened after a halt', async () => {
      const first = makeMockClient();
      vi.mocked(first.fetchUnread).mockRejectedValue(new Error('Connection lost'));
      const second = makeMockClient([makeMessage()]);
      let connected = (): void => undefined;
      vi.mocked(second.connect).mockReturnValue(new Promise((resolve) => { connected = resolve; }));
      const clients = [first, second];
      receiver = new EmailReceiver(makeConfig(), () => clients.shift()!, makeMockLogger().logger);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(10_000);

      await receiver.onHalt();
      connected();
      await vi.advanceTimersByTimeAsync(0);

      expect(second.fetchUnread).not.toHaveBeenCalled();
      expect(second.disconnect).toHaveBeenCalledOnce();
      receiver = null;
    });

    it('a halt closes an idle connection without asking a server that may not answer (#413)', async () => {
      const client = makeMockClient();
      vi.mocked(client.disconnect).mockReturnValue(new Promise(() => { /* never */ }));
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      expect((await receiver.onHalt()).ok).toBe(true);

      expect(client.destroy).toHaveBeenCalledOnce();
      receiver = null;
    });
  });

  describe('lifecycle', () => {
    it('stops and disconnects client', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      const stopResult = await receiver.onStop();
      expect(stopResult.ok).toBe(true);
      expect(client.disconnect).toHaveBeenCalledOnce();

      const undeployResult = await receiver.onUndeploy();
      expect(undeployResult.ok).toBe(true);

      receiver = null;
    });

    it('undeploy clears dispatcher', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());

      await receiver.onUndeploy();

      const startResult = await receiver.onStart();
      expect(startResult.ok).toBe(false);

      receiver = null;
    });
  });

  describe('failure visibility & reconnect', () => {
    it('logs a poll failure and reconnects on the next cycle', async () => {
      const client1 = makeMockClient();
      vi.mocked(client1.fetchUnread).mockRejectedValue(new Error('IMAP connection dropped'));
      const client2 = makeMockClient([makeMessage()]);

      const clients = [client1, client2];
      let idx = 0;
      const factory: ImapClientFactory = (): ImapClient => clients[idx++]!;

      const dispatched: RawMessage[] = [];
      const { logger, errors } = makeMockLogger();
      receiver = new EmailReceiver(makeConfig({ pollingIntervalMs: 1_000 }), factory, logger);
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw); return { messageId: 1 }; }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(1_000);
      expect(errors.some((e) => e.msg.includes('poll cycle failed'))).toBe(true);
      expect(dispatched).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(vi.mocked(client2.connect)).toHaveBeenCalled();
      expect(dispatched).toHaveLength(1);
    });

    it('times out a hung fetchUnread instead of wedging the poll loop', async () => {
      const client = makeMockClient();
      vi.mocked(client.fetchUnread).mockReturnValue(new Promise(() => { /* never */ }));

      const { logger, errors } = makeMockLogger();
      receiver = new EmailReceiver(makeConfig({ pollingIntervalMs: 1_000 }), makeClientFactory(client), logger);
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      // Trigger a poll, then let the 30s op timeout elapse.
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(errors.some((e) => e.msg.includes('poll cycle failed'))).toBe(true);
    });

    it('times out a hung disconnect after a poll failure and reconnects on a fresh client', async () => {
      const client1 = makeMockClient();
      vi.mocked(client1.fetchUnread).mockRejectedValue(new Error('IMAP connection dropped'));
      vi.mocked(client1.disconnect).mockReturnValue(new Promise(() => { /* never */ }));
      const client2 = makeMockClient();
      vi.mocked(client2.fetchUnread).mockResolvedValueOnce([makeMessage()]);

      const clients = [client1, client2];
      let idx = 0;
      const factory: ImapClientFactory = (): ImapClient => clients[idx++]!;

      const dispatched: RawMessage[] = [];
      const { logger, warnings } = makeMockLogger();
      receiver = new EmailReceiver(makeConfig({ pollingIntervalMs: 1_000 }), factory, logger);
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw); return { messageId: 1 }; }));
      await receiver.onStart();

      // Poll fails, then the hung disconnect must give up after the 30s op timeout.
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.advanceTimersByTimeAsync(30_000);
      const warning = warnings.find((w) => w.msg === 'Error disconnecting IMAP client');
      expect(warning?.obj['errMsg']).toBe('IMAP disconnect timed out after 30000ms');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(vi.mocked(client2.connect)).toHaveBeenCalledOnce();
      expect(dispatched).toHaveLength(1);
    });
  });

  describe('dispatched keyword', () => {
    it('sets the GalvaniGraph keyword', () => {
      expect(DISPATCHED_KEYWORD).toBe('$GalvaniGraphDispatched');
    });

    // Earlier names' keywords (D-205, D-309), so an email handled before a rename is not delivered twice.
    it.each(['$GalvaniGraphDispatched', '$GalvaniFlowDispatched', '$MirthlessDispatched'])(
      'counts an email marked %s as dispatched',
      (keyword) => {
        expect(hasDispatchedKeyword(new Set(['\\Flagged', keyword]))).toBe(true);
      },
    );

    it('treats an email without either keyword, or without flags, as not dispatched', () => {
      expect(hasDispatchedKeyword(new Set(['\\Flagged', '$Other']))).toBe(false);
      expect(hasDispatchedKeyword(undefined)).toBe(false);
    });

    it('reads a keyword in whatever case the server answers with', () => {
      expect(hasDispatchedKeyword(new Set(['$galvanigraphdispatched']))).toBe(true);
      expect(hasErrorKeyword(new Set(['$GALVANIGRAPHERROR']))).toBe(true);
      expect(hasErrorKeyword(new Set([DISPATCHED_KEYWORD]))).toBe(false);
      expect(hasErrorKeyword(undefined)).toBe(false);
    });

    async function startWith(client: ImapClient, dispatched: RawMessage[], logger = makeMockLogger().logger): Promise<void> {
      receiver = new EmailReceiver(makeConfig({ postAction: EMAIL_POST_ACTION.MARK_READ }), makeClientFactory(client), logger);
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw); return { messageId: 1 }; }));
      await receiver.onStart();
    }

    it('marks the email dispatched on the server before running the post-action', async () => {
      const client = makeMockClient([makeMessage({ uid: 3 })]);
      await startWith(client, []);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.mark).toHaveBeenCalledWith(3, DISPATCHED_KEYWORD);
      const markOrder = vi.mocked(client.mark).mock.invocationCallOrder[0]!;
      const readOrder = vi.mocked(client.markRead).mock.invocationCallOrder[0]!;
      expect(markOrder).toBeLessThan(readOrder);
    });

    it('after a restart, retries only the post-action for an email that carries the keyword', async () => {
      const client = makeMockClient([makeMessage({ uid: 4, dispatched: true })]);
      const dispatched: RawMessage[] = [];
      await startWith(client, dispatched);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatched).toHaveLength(0);
      expect(client.mark).not.toHaveBeenCalled();
      expect(client.markRead).toHaveBeenCalledWith(4);
    });

    it('does not mark an email whose dispatch failed', async () => {
      const client = makeMockClient([makeMessage({ uid: 5 })]);
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client), makeMockLogger().logger);
      receiver.setDispatcher(makeFailDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.mark).not.toHaveBeenCalled();
    });

    it('warns once when the mailbox does not accept custom keywords, and still finishes each email', async () => {
      const client = makeMockClient([makeMessage({ uid: 1 }), makeMessage({ uid: 2 })]);
      vi.mocked(client.mark).mockResolvedValue(false);
      const { logger, warnings } = makeMockLogger();
      const dispatched: RawMessage[] = [];
      await startWith(client, dispatched, logger);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatched).toHaveLength(2);
      expect(client.markRead).toHaveBeenCalledTimes(2);
      const keywordWarnings = warnings.filter((w) => w.obj['keyword'] === DISPATCHED_KEYWORD);
      expect(keywordWarnings).toHaveLength(1);
    });

    it('takes no further email on a connection that could not set the keyword, and runs the post-action on the next (#413)', async () => {
      const client = makeMockClient([makeMessage({ uid: 6 }), makeMessage({ uid: 7 })]);
      vi.mocked(client.mark).mockRejectedValueOnce(new Error('Connection lost'));
      const { logger, errors } = makeMockLogger();
      const dispatched: RawMessage[] = [];
      await startWith(client, dispatched, logger);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(errors.some((e) => e.msg.includes('Could not mark the email on the server'))).toBe(true);
      // The second could not have been marked either, and a restart would dispatch it again.
      expect(dispatched).toHaveLength(1);
      expect(client.markRead).not.toHaveBeenCalled();
      expect(client.disconnect).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(dispatched).toHaveLength(2);
      expect(client.markRead).toHaveBeenNthCalledWith(1, 6);
      expect(client.markRead).toHaveBeenNthCalledWith(2, 7);
    });

    it('takes no further email on a connection whose post-action hangs (#413)', async () => {
      const client = makeMockClient([makeMessage({ uid: 6 }), makeMessage({ uid: 7 })]);
      vi.mocked(client.markRead).mockReturnValueOnce(new Promise(() => { /* never */ }));
      const { logger } = makeMockLogger();
      const dispatched: RawMessage[] = [];
      await startWith(client, dispatched, logger);

      await vi.advanceTimersByTimeAsync(34_000);
      expect(dispatched).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(dispatched).toHaveLength(2);
      expect(client.disconnect).toHaveBeenCalledOnce();
    });
  });
});

describe('EmailReceiver when the pipeline recorded an error', () => {
  function errorDispatcher(dispatched: string[]): (raw: RawMessage) => Promise<Result<DispatchResult>> {
    return async (raw) => {
      dispatched.push(raw.content);
      return { ok: true as const, value: { messageId: 5, status: 'ERROR' as const }, error: null };
    };
  }

  it('leaves the email in the mailbox, marks it and does not dispatch it again', async () => {
    const client = makeMockClient();
    vi.mocked(client.fetchUnread).mockResolvedValueOnce([makeMessage({ uid: 77 })]).mockResolvedValue([makeMessage({ uid: 77, held: true })]);
    const dispatched: string[] = [];
    const { logger, warnings } = makeMockLogger();
    receiver = new EmailReceiver(makeConfig({ postAction: EMAIL_POST_ACTION.DELETE }), makeClientFactory(client), logger);
    receiver.setDispatcher(errorDispatcher(dispatched));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(warnings).toEqual([]);
    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(client.markRead).not.toHaveBeenCalled();
    expect(client.moveMessage).not.toHaveBeenCalled();
    expect(client.mark).toHaveBeenCalledExactlyOnceWith(77, ERROR_KEYWORD);
    expect(dispatched).toHaveLength(1);
  });

  it('a new instance, as after a redeploy, leaves an email that carries the mark alone, and says so once (#413)', async () => {
    const client = makeMockClient([makeMessage({ uid: 77, held: true })]);
    const dispatched: string[] = [];
    const { logger, warnings } = makeMockLogger();
    receiver = new EmailReceiver(makeConfig({ postAction: EMAIL_POST_ACTION.DELETE }), makeClientFactory(client), logger);
    receiver.setDispatcher(errorDispatcher(dispatched));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(dispatched).toEqual([]);
    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(client.mark).not.toHaveBeenCalled();
    expect(warnings.map((w) => w.obj)).toEqual([{ emails: 1, uids: [77], folder: 'INBOX' }]);
  });

  it('sets the mark again at the next poll when it could not', async () => {
    const client = makeMockClient();
    vi.mocked(client.fetchUnread)
      .mockResolvedValueOnce([makeMessage({ uid: 77 })])
      .mockResolvedValueOnce([makeMessage({ uid: 77 })])
      .mockResolvedValue([makeMessage({ uid: 77, held: true })]);
    vi.mocked(client.mark).mockRejectedValueOnce(new Error('Connection lost'));
    const dispatched: string[] = [];
    receiver = new EmailReceiver(makeConfig(), makeClientFactory(client), makeMockLogger().logger);
    receiver.setDispatcher(errorDispatcher(dispatched));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(vi.mocked(client.mark).mock.calls).toEqual([[77, ERROR_KEYWORD], [77, ERROR_KEYWORD]]);
    expect(dispatched).toHaveLength(1);
  });

  it('reads the email again once the mark is removed from it, without a redeploy', async () => {
    const client = makeMockClient();
    vi.mocked(client.fetchUnread)
      .mockResolvedValueOnce([makeMessage({ uid: 77 })])
      .mockResolvedValueOnce([makeMessage({ uid: 77, held: true })])
      .mockResolvedValueOnce([makeMessage({ uid: 77 })])
      .mockResolvedValue([makeMessage({ uid: 77, held: true })]);
    const dispatched: string[] = [];
    receiver = new EmailReceiver(makeConfig(), makeClientFactory(client), makeMockLogger().logger);
    receiver.setDispatcher(errorDispatcher(dispatched));
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(dispatched).toHaveLength(2);
  });
});

describe('EmailReceiver with post-action DELETE (#413)', () => {
  async function startDeleting(client: ImapClient, outcome: Partial<DispatchResult> = {}): Promise<{ dispatched: string[]; warnings: ReturnType<typeof makeMockLogger>['warnings']; errors: ReturnType<typeof makeMockLogger>['errors'] }> {
    const { logger, warnings, errors } = makeMockLogger();
    const dispatched: string[] = [];
    receiver = new EmailReceiver(makeConfig({ postAction: EMAIL_POST_ACTION.DELETE }), makeClientFactory(client), logger);
    receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw.content); return { messageId: 1, ...outcome }; }));
    await receiver.onStart();
    return { dispatched, warnings, errors };
  }

  it('deletes no email that only its keyword says was dispatched, and says once how many it leaves', async () => {
    const client = makeMockClient([makeMessage({ uid: 1, dispatched: true }), makeMessage({ uid: 2, dispatched: true }), makeMessage({ uid: 3 })]);
    const { dispatched, warnings } = await startDeleting(client);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(dispatched).toHaveLength(1);
    expect(vi.mocked(client.deleteMessage).mock.calls.map(([uid]) => uid)).not.toContain(1);
    expect(vi.mocked(client.deleteMessage).mock.calls.map(([uid]) => uid)).not.toContain(2);
    expect(warnings.map((w) => w.obj)).toEqual([{ emails: 2, uids: [1, 2], folder: 'INBOX' }]);
  });

  it('retries the deletion of an email it dispatched itself, which carries its keyword by then', async () => {
    const client = makeMockClient();
    vi.mocked(client.fetchUnread)
      .mockResolvedValueOnce([makeMessage({ uid: 4 })])
      .mockResolvedValueOnce([makeMessage({ uid: 4, dispatched: true })])
      .mockResolvedValue([]);
    vi.mocked(client.deleteMessage).mockRejectedValueOnce(new ImapRefusal('refused'));
    const { dispatched } = await startDeleting(client);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(dispatched).toHaveLength(1);
    expect(client.deleteMessage).toHaveBeenCalledTimes(2);
  });

  it('does not dispatch an email again that the server says it deleted and goes on listing', async () => {
    const client = makeMockClient([makeMessage({ uid: 5 })]);
    vi.mocked(client.mark).mockResolvedValue(false);
    const { dispatched } = await startDeleting(client);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(dispatched).toHaveLength(1);
    expect(client.deleteMessage).toHaveBeenCalledTimes(3);
  });

  it('keeps an email whose message has a failed destination, as one recorded with an error', async () => {
    const client = makeMockClient();
    vi.mocked(client.fetchUnread).mockResolvedValueOnce([makeMessage({ uid: 6 })]).mockResolvedValue([makeMessage({ uid: 6, held: true })]);
    const { dispatched } = await startDeleting(client, { destinationFailed: true });

    await vi.advanceTimersByTimeAsync(15_000);

    expect(dispatched).toHaveLength(1);
    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(client.mark).toHaveBeenCalledExactlyOnceWith(6, ERROR_KEYWORD);
  });

  it('marks an email read, and does not delete it, when its message cannot hold all its bytes', async () => {
    const client = makeMockClient();
    vi.mocked(client.fetchUnread)
      .mockResolvedValueOnce([makeMessage({ uid: 7, source: Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72]) })])
      .mockResolvedValue([]);
    const { errors } = await startDeleting(client);

    await vi.advanceTimersByTimeAsync(5_000);

    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(client.markRead).toHaveBeenCalledExactlyOnceWith(7);
    expect(errors.map((e) => e.msg)).toEqual([expect.stringContaining('marked read, not deleted')]);
  });
});

describe('EmailReceiver when the mailbox was made anew (#413)', () => {
  // A UID means nothing under another UIDVALIDITY.
  it('does not take a new email for the one whose post-action failed', async () => {
    const client = makeMockClient([makeMessage({ uid: 1, body: 'old' })]);
    vi.mocked(client.deleteMessage).mockRejectedValueOnce(new ImapRefusal('refused'));
    const dispatched: string[] = [];
    receiver = new EmailReceiver(makeConfig({ postAction: EMAIL_POST_ACTION.DELETE }), makeClientFactory(client), makeMockLogger().logger);
    receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw.content); return { messageId: 1 }; }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    vi.mocked(client.fetchUnread).mockResolvedValueOnce([makeMessage({ uid: 1, uidValidity: '2', body: 'new' })]).mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(dispatched).toEqual(['old', 'new']);
  });

  it('does not take a new email for the one that was recorded with an error', async () => {
    const client = makeMockClient([makeMessage({ uid: 1, body: 'old' })]);
    const dispatched: string[] = [];
    receiver = new EmailReceiver(makeConfig(), makeClientFactory(client), makeMockLogger().logger);
    receiver.setDispatcher(makeDispatcher((raw) => {
      dispatched.push(raw.content);
      return { messageId: 1, status: raw.content === 'old' ? 'ERROR' : 'PROCESSED' };
    }));
    await receiver.onStart();
    await vi.advanceTimersByTimeAsync(5_000);

    vi.mocked(client.fetchUnread).mockResolvedValueOnce([makeMessage({ uid: 1, uidValidity: '2', body: 'new' })]).mockResolvedValue([]);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(dispatched).toEqual(['old', 'new']);
  });
});
