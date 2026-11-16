// ===========================================
// Email Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import { stderr, type Result } from '@galvanigraph/core-util';
import {
  EmailReceiver,
  EMAIL_PROTOCOL,
  EMAIL_POST_ACTION,
  DISPATCHED_KEYWORD,
  hasDispatchedKeyword,
  type EmailReceiverConfig,
  type ImapClient,
  type ImapClientFactory,
  type EmailMessage,
} from '../email-receiver.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

// ----- Helpers -----

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
    includeAttachments: false,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<EmailMessage>): EmailMessage {
  return {
    uid: 1,
    subject: 'Lab Results',
    from: 'sender@hospital.org',
    to: 'receiver@clinic.org',
    date: '2026-01-15T10:30:00.000Z',
    body: 'MSH|^~\\&|SENDER|HOSPITAL',
    attachmentCount: 0,
    dispatched: false,
    ...overrides,
  };
}

function makeMockClient(messages: readonly EmailMessage[] = []): ImapClient {
  return {
    connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    fetchUnread: vi.fn<(folder: string) => Promise<readonly EmailMessage[]>>().mockResolvedValue(messages),
    markRead: vi.fn<(uid: number) => Promise<void>>().mockResolvedValue(undefined),
    markDispatched: vi.fn<(uid: number) => Promise<boolean>>().mockResolvedValue(true),
    moveMessage: vi.fn<(uid: number, folder: string) => Promise<void>>().mockResolvedValue(undefined),
    deleteMessage: vi.fn<(uid: number) => Promise<void>>().mockResolvedValue(undefined),
    disconnect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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

// ----- Lifecycle -----

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

// ----- Tests -----

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
      const client = makeMockClient([msg]); // stays unread until markRead succeeds
      vi.mocked(client.markRead)
        .mockRejectedValueOnce(new Error('IMAP STORE failed'))
        .mockResolvedValue(undefined);
      const dispatched: RawMessage[] = [];
      const { logger, errors } = makeMockLogger();

      receiver = new EmailReceiver(makeConfig({ postAction: EMAIL_POST_ACTION.MARK_READ }), makeClientFactory(client), logger);
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw); return { messageId: 1 }; }));
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000); // dispatch ok, markRead fails
      await vi.advanceTimersByTimeAsync(5_000); // same email fetched again: post-action retried only

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
      expect(errors.some((e) => e.msg.includes('could not be processed') && e.obj['uid'] === 1)).toBe(true);
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

      // First poll fails
      await vi.advanceTimersByTimeAsync(5_000);
      expect(captured).toHaveLength(0);

      // Second poll succeeds
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

  // Pause is onStop then onStart on the same instance. An email whose dispatch
  // was in flight when the channel stopped must not be dispatched again.
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

    it('halt during a dispatch keeps the email awaiting its post-action, so resume retries only the post-action', async () => {
      const client = makeMockClient([makeMessage({ uid: 8 })]);
      const pending = pendingDispatcher();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(pending.dispatcher);
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);

      expect((await receiver.onHalt()).ok).toBe(true);
      pending.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.markRead).not.toHaveBeenCalled();

      // Still unread on the server (no post-action ran), so resume sees it again.
      await receiver.onStart();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(pending.calls()).toBe(1);
      expect(client.markRead).toHaveBeenCalledWith(8);
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

    it('halt disconnects client', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());
      await receiver.onStart();

      const haltResult = await receiver.onHalt();
      expect(haltResult.ok).toBe(true);
      expect(client.disconnect).toHaveBeenCalledOnce();

      receiver = null;
    });

    it('undeploy clears dispatcher', async () => {
      const client = makeMockClient();
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client));
      receiver.setDispatcher(makeDispatcher());

      await receiver.onUndeploy();

      // After undeploy, start should fail because dispatcher is cleared
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

      // Cycle 1: fetch fails → error logged, client dropped.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(errors.some((e) => e.msg.includes('poll cycle failed'))).toBe(true);
      expect(dispatched).toHaveLength(0);

      // Cycle 2: reconnect with fresh client → message dispatched.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(vi.mocked(client2.connect)).toHaveBeenCalled();
      expect(dispatched).toHaveLength(1);
    });

    it('times out a hung fetchUnread instead of wedging the poll loop', async () => {
      const client = makeMockClient();
      // fetchUnread never resolves → must be bounded by the op timeout.
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
      // One unread email, marked read by the first poll that sees it.
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
      const warning = warnings.find((w) => w.msg === 'Error disconnecting IMAP client during reconnect');
      expect(warning?.obj['errMsg']).toBe('IMAP disconnect timed out after 30000ms');

      // The next cycle reconnects on a fresh client and dispatches.
      await vi.advanceTimersByTimeAsync(1_000);
      expect(vi.mocked(client2.connect)).toHaveBeenCalledOnce();
      expect(dispatched).toHaveLength(1);
    });
  });

  describe('dispatched keyword', () => {
    it('sets the GalvaniGraph keyword', () => {
      expect(DISPATCHED_KEYWORD).toBe('$GalvaniGraphDispatched');
    });

    // Keywords set under the product's earlier names (D-205, D-309). Counting them
    // as dispatched keeps an email handled before a rename from being delivered twice.
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

    async function startWith(client: ImapClient, dispatched: RawMessage[], logger = makeMockLogger().logger): Promise<void> {
      receiver = new EmailReceiver(makeConfig({ postAction: EMAIL_POST_ACTION.MARK_READ }), makeClientFactory(client), logger);
      receiver.setDispatcher(makeDispatcher((raw) => { dispatched.push(raw); return { messageId: 1 }; }));
      await receiver.onStart();
    }

    it('marks the email dispatched on the server before running the post-action', async () => {
      const client = makeMockClient([makeMessage({ uid: 3 })]);
      await startWith(client, []);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.markDispatched).toHaveBeenCalledWith(3);
      const markOrder = vi.mocked(client.markDispatched).mock.invocationCallOrder[0]!;
      const readOrder = vi.mocked(client.markRead).mock.invocationCallOrder[0]!;
      expect(markOrder).toBeLessThan(readOrder);
    });

    it('after a restart, retries only the post-action for an email that carries the keyword', async () => {
      const client = makeMockClient([makeMessage({ uid: 4, dispatched: true })]);
      const dispatched: RawMessage[] = [];
      await startWith(client, dispatched);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatched).toHaveLength(0);
      expect(client.markDispatched).not.toHaveBeenCalled();
      expect(client.markRead).toHaveBeenCalledWith(4);
    });

    it('does not mark an email whose dispatch failed', async () => {
      const client = makeMockClient([makeMessage({ uid: 5 })]);
      receiver = new EmailReceiver(makeConfig(), makeClientFactory(client), makeMockLogger().logger);
      receiver.setDispatcher(makeFailDispatcher());
      await receiver.onStart();

      await vi.advanceTimersByTimeAsync(5_000);

      expect(client.markDispatched).not.toHaveBeenCalled();
    });

    it('warns once when the mailbox does not accept custom keywords, and still finishes each email', async () => {
      const client = makeMockClient([makeMessage({ uid: 1 }), makeMessage({ uid: 2 })]);
      vi.mocked(client.markDispatched).mockResolvedValue(false);
      const { logger, warnings } = makeMockLogger();
      const dispatched: RawMessage[] = [];
      await startWith(client, dispatched, logger);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(dispatched).toHaveLength(2);
      expect(client.markRead).toHaveBeenCalledTimes(2);
      const keywordWarnings = warnings.filter((w) => w.obj['keyword'] === DISPATCHED_KEYWORD);
      expect(keywordWarnings).toHaveLength(1);
    });

    it('logs an error and still runs the post-action when setting the keyword fails', async () => {
      const client = makeMockClient([makeMessage({ uid: 6 })]);
      vi.mocked(client.markDispatched).mockRejectedValue(new Error('IMAP STORE failed'));
      const { logger, errors } = makeMockLogger();
      await startWith(client, [], logger);

      await vi.advanceTimersByTimeAsync(5_000);

      expect(errors.some((e) => e.msg.includes('Could not mark email as dispatched'))).toBe(true);
      expect(client.markRead).toHaveBeenCalledWith(6);
    });
  });
});

describe('EmailReceiver when the pipeline recorded an error', () => {
  it('leaves the email untouched and does not dispatch it again', async () => {
    const msg = makeMessage({ uid: 77 });
    const client = makeMockClient([msg]);
    let dispatches = 0;

    receiver = new EmailReceiver(
      makeConfig({ postAction: EMAIL_POST_ACTION.DELETE }),
      makeClientFactory(client),
    );
    receiver.setDispatcher(async () => {
      dispatches += 1;
      return { ok: true as const, value: { messageId: 5, status: 'ERROR' as const }, error: null };
    });
    await receiver.onStart();

    await vi.advanceTimersByTimeAsync(15_000);

    expect(client.deleteMessage).not.toHaveBeenCalled();
    expect(client.markRead).not.toHaveBeenCalled();
    expect(client.moveMessage).not.toHaveBeenCalled();
    expect(dispatches).toBe(1);
  });
});
