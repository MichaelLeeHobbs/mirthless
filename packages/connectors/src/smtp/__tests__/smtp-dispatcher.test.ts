// ===========================================
// SMTP Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import {
  SmtpDispatcher,
  substituteTemplate,
  type SmtpDispatcherConfig,
  type SmtpTransport,
  type SmtpMailOptions,
  type TransportFactory,
} from '../smtp-dispatcher.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<SmtpDispatcherConfig>): SmtpDispatcherConfig {
  return {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: { user: 'test@example.com', pass: 'secret' },
    from: 'sender@example.com',
    to: 'recipient@example.com',
    cc: '',
    bcc: '',
    subject: 'Alert: ${channelId}',
    bodyTemplate: 'Message: ${msg}',
    contentType: 'text/plain',
    attachContent: false,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: 'ch-1',
    messageId: 42,
    metaDataId: 1,
    content: 'HL7 message content',
    dataType: 'RAW',
    ...overrides,
  };
}

function makeSignal(aborted = false): AbortSignal {
  if (aborted) return AbortSignal.abort();
  return new AbortController().signal;
}

function makeMockTransport(overrides?: Partial<SmtpTransport>): SmtpTransport {
  return {
    sendMail: vi.fn(async () => ({
      messageId: '<test-id@example.com>',
      accepted: ['recipient@example.com'],
      rejected: [],
    })),
    close: vi.fn(),
    ...overrides,
  };
}

function makeFactory(transport: SmtpTransport): TransportFactory {
  return () => transport;
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- substituteTemplate -----

describe('substituteTemplate', () => {
  const msg = makeMessage();

  it('substitutes ${msg} with content', () => {
    expect(substituteTemplate('Body: ${msg}', 'hello', msg)).toBe('Body: hello');
  });

  it('substitutes ${messageId}', () => {
    expect(substituteTemplate('ID: ${messageId}', '', msg)).toBe('ID: 42');
  });

  it('substitutes ${channelId}', () => {
    expect(substituteTemplate('Ch: ${channelId}', '', msg)).toBe('Ch: ch-1');
  });

  it('substitutes ${metaDataId}', () => {
    expect(substituteTemplate('Meta: ${metaDataId}', '', msg)).toBe('Meta: 1');
  });

  it('handles multiple substitutions', () => {
    const tpl = '${channelId} - ${messageId}: ${msg}';
    expect(substituteTemplate(tpl, 'data', msg)).toBe('ch-1 - 42: data');
  });

  it('returns template unchanged when no placeholders', () => {
    expect(substituteTemplate('plain text', 'data', msg)).toBe('plain text');
  });
});

// ----- onDeploy -----

describe('SmtpDispatcher.onDeploy', () => {
  it('succeeds with valid config', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig());
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(true);
  });

  it('fails when host is empty', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig({ host: '' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when from is empty', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig({ from: '' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when to is empty', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig({ to: '' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when port is out of range (0)', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig({ port: 0 }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when port is out of range (70000)', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig({ port: 70000 }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });
});

// ----- Lifecycle -----

describe('SmtpDispatcher lifecycle', () => {
  it('starts successfully', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig());
    const result = await dispatcher.onStart();
    expect(result.ok).toBe(true);
  });

  it('stops successfully', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.onStop();
    expect(result.ok).toBe(true);
  });

  it('halts successfully', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig());
    await dispatcher.onStart();
    const result = await dispatcher.onHalt();
    expect(result.ok).toBe(true);
  });

  it('undeploys successfully', async () => {
    const dispatcher = new SmtpDispatcher(makeConfig());
    const result = await dispatcher.onUndeploy();
    expect(result.ok).toBe(true);
  });
});

// ----- send -----

describe('SmtpDispatcher.send', () => {
  it('sends email and returns SENT', async () => {
    const transport = makeMockTransport();
    const dispatcher = new SmtpDispatcher(makeConfig(), makeFactory(transport));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toContain('accepted=1');
    }
  });

  it('calls sendMail with correct options for text/plain', async () => {
    const transport = makeMockTransport();
    const dispatcher = new SmtpDispatcher(makeConfig(), makeFactory(transport));
    await dispatcher.onStart();

    await dispatcher.send(makeMessage(), makeSignal());

    const sendMail = transport.sendMail as ReturnType<typeof vi.fn>;
    expect(sendMail).toHaveBeenCalledTimes(1);
    const opts = sendMail.mock.calls[0]?.[0] as SmtpMailOptions;
    expect(opts.from).toBe('sender@example.com');
    expect(opts.to).toBe('recipient@example.com');
    expect(opts.subject).toBe('Alert: ch-1');
    expect(opts.text).toBe('Message: HL7 message content');
    expect(opts.html).toBeUndefined();
  });

  it('sends html email when contentType is text/html', async () => {
    const transport = makeMockTransport();
    const config = makeConfig({ contentType: 'text/html' });
    const dispatcher = new SmtpDispatcher(config, makeFactory(transport));
    await dispatcher.onStart();

    await dispatcher.send(makeMessage(), makeSignal());

    const sendMail = transport.sendMail as ReturnType<typeof vi.fn>;
    const opts = sendMail.mock.calls[0]?.[0] as SmtpMailOptions;
    expect(opts.html).toBe('Message: HL7 message content');
    expect(opts.text).toBeUndefined();
  });

  it('includes attachment when attachContent is true', async () => {
    const transport = makeMockTransport();
    const config = makeConfig({ attachContent: true });
    const dispatcher = new SmtpDispatcher(config, makeFactory(transport));
    await dispatcher.onStart();

    await dispatcher.send(makeMessage({ content: 'file data' }), makeSignal());

    const sendMail = transport.sendMail as ReturnType<typeof vi.fn>;
    const opts = sendMail.mock.calls[0]?.[0] as SmtpMailOptions;
    expect(opts.attachments).toHaveLength(1);
    expect(opts.attachments?.[0]?.content).toBe('file data');
  });

  it('includes cc and bcc when provided', async () => {
    const transport = makeMockTransport();
    const config = makeConfig({ cc: 'cc@test.com', bcc: 'bcc@test.com' });
    const dispatcher = new SmtpDispatcher(config, makeFactory(transport));
    await dispatcher.onStart();

    await dispatcher.send(makeMessage(), makeSignal());

    const sendMail = transport.sendMail as ReturnType<typeof vi.fn>;
    const opts = sendMail.mock.calls[0]?.[0] as SmtpMailOptions;
    expect(opts.cc).toBe('cc@test.com');
    expect(opts.bcc).toBe('bcc@test.com');
  });

  it('closes transport after send', async () => {
    const transport = makeMockTransport();
    const dispatcher = new SmtpDispatcher(makeConfig(), makeFactory(transport));
    await dispatcher.onStart();

    await dispatcher.send(makeMessage(), makeSignal());

    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('closes transport even on send failure', async () => {
    const transport = makeMockTransport({
      sendMail: vi.fn(async () => { throw new Error('SMTP error'); }),
      close: vi.fn(),
    });
    const dispatcher = new SmtpDispatcher(makeConfig(), makeFactory(transport));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
    expect(transport.close).toHaveBeenCalledTimes(1);
  });

  it('fails when not started', async () => {
    const transport = makeMockTransport();
    const dispatcher = new SmtpDispatcher(makeConfig(), makeFactory(transport));
    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
  });

  it('fails when signal is aborted', async () => {
    const transport = makeMockTransport();
    const dispatcher = new SmtpDispatcher(makeConfig(), makeFactory(transport));
    await dispatcher.onStart();
    const result = await dispatcher.send(makeMessage(), makeSignal(true));
    expect(result.ok).toBe(false);
  });
});
