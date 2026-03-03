// ===========================================
// Email Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RawMessage, DispatchResult } from '../../base.js';
import type { Result } from '@mirthless/core-util';
import {
  EmailReceiver,
  EMAIL_PROTOCOL,
  EMAIL_POST_ACTION,
  type EmailReceiverConfig,
  type ImapClient,
  type ImapClientFactory,
  type EmailMessage,
} from '../email-receiver.js';

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
    ...overrides,
  };
}

function makeMockClient(messages: readonly EmailMessage[] = []): ImapClient {
  return {
    connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    fetchUnread: vi.fn<(folder: string) => Promise<readonly EmailMessage[]>>().mockResolvedValue(messages),
    markRead: vi.fn<(uid: number) => Promise<void>>().mockResolvedValue(undefined),
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
    error: { name: 'Error', code: 'DISPATCH_FAILED', message: 'dispatch failed' },
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
});
