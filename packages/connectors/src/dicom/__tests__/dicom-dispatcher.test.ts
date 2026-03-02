// ===========================================
// DICOM Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConnectorMessage } from '../../base.js';
import {
  DicomDispatcher,
  type DicomDispatcherConfig,
  type DcmtkSender,
  type DcmtkSendResult,
  type SenderFactory,
} from '../dicom-dispatcher.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<DicomDispatcherConfig>): DicomDispatcherConfig {
  return {
    host: '192.168.1.100',
    port: 104,
    calledAETitle: 'PACS',
    callingAETitle: 'MIRTHLESS',
    mode: 'multiple',
    maxAssociations: 4,
    maxRetries: 3,
    retryDelayMs: 1_000,
    timeoutMs: 30_000,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: 'ch-1',
    messageId: 42,
    metaDataId: 1,
    content: '/data/dicom/output/image.dcm',
    dataType: 'DICOM',
    ...overrides,
  };
}

function makeSignal(aborted = false): AbortSignal {
  if (aborted) return AbortSignal.abort();
  return new AbortController().signal;
}

function makeMockSender(overrides?: Partial<DcmtkSender>): DcmtkSender {
  return {
    send: vi.fn(async () => ({
      ok: true as const,
      value: { files: ['/data/dicom/output/image.dcm'], fileCount: 1, durationMs: 150 } as DcmtkSendResult,
      error: null,
    })),
    stop: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeMockFactory(sender: DcmtkSender): SenderFactory {
  return () => ({ ok: true as const, value: sender, error: null });
}

function makeFailingFactory(message: string): SenderFactory {
  return () => ({ ok: false as const, value: null, error: new Error(message) });
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- onDeploy -----

describe('DicomDispatcher.onDeploy', () => {
  it('succeeds with valid config', async () => {
    const dispatcher = new DicomDispatcher(makeConfig());
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(true);
  });

  it('fails when host is empty', async () => {
    const dispatcher = new DicomDispatcher(makeConfig({ host: '' }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when port is out of range (0)', async () => {
    const dispatcher = new DicomDispatcher(makeConfig({ port: 0 }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when port is out of range (70000)', async () => {
    const dispatcher = new DicomDispatcher(makeConfig({ port: 70000 }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when calledAETitle exceeds 16 characters', async () => {
    const dispatcher = new DicomDispatcher(makeConfig({ calledAETitle: 'A'.repeat(17) }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when callingAETitle exceeds 16 characters', async () => {
    const dispatcher = new DicomDispatcher(makeConfig({ callingAETitle: 'A'.repeat(17) }));
    const result = await dispatcher.onDeploy();
    expect(result.ok).toBe(false);
  });
});

// ----- onStart -----

describe('DicomDispatcher.onStart', () => {
  it('creates sender and starts successfully', async () => {
    const sender = makeMockSender();
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    const result = await dispatcher.onStart();
    expect(result.ok).toBe(true);
  });

  it('fails when factory returns error', async () => {
    const dispatcher = new DicomDispatcher(makeConfig(), makeFailingFactory('Create failed'));
    const result = await dispatcher.onStart();
    expect(result.ok).toBe(false);
  });
});

// ----- send -----

describe('DicomDispatcher.send', () => {
  it('sends file and returns SENT on success', async () => {
    const sender = makeMockSender();
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toContain('files=1');
      expect(result.value.content).toContain('durationMs=150');
    }
  });

  it('returns ERROR when send fails', async () => {
    const sender = makeMockSender({
      send: vi.fn(async () => ({
        ok: false as const,
        value: null,
        error: new Error('Connection refused'),
      })),
    });
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('ERROR');
      expect(result.value.errorMessage).toBe('Connection refused');
    }
  });

  it('fails when not started', async () => {
    const dispatcher = new DicomDispatcher(makeConfig());
    const result = await dispatcher.send(makeMessage(), makeSignal());
    expect(result.ok).toBe(false);
  });

  it('fails when signal is aborted', async () => {
    const sender = makeMockSender();
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage(), makeSignal(true));
    expect(result.ok).toBe(false);
  });

  it('fails when content is empty', async () => {
    const sender = makeMockSender();
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    await dispatcher.onStart();

    const result = await dispatcher.send(makeMessage({ content: '' }), makeSignal());
    expect(result.ok).toBe(false);
  });

  it('trims whitespace from file path', async () => {
    const sender = makeMockSender();
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    await dispatcher.onStart();

    await dispatcher.send(makeMessage({ content: '  /data/file.dcm  ' }), makeSignal());

    const sendFn = sender.send as ReturnType<typeof vi.fn>;
    expect(sendFn).toHaveBeenCalledWith(['/data/file.dcm']);
  });
});

// ----- Lifecycle -----

describe('DicomDispatcher lifecycle', () => {
  it('stops sender', async () => {
    const sender = makeMockSender();
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    await dispatcher.onStart();

    const result = await dispatcher.onStop();
    expect(result.ok).toBe(true);
    expect(sender.stop).toHaveBeenCalledTimes(1);
  });

  it('halts sender', async () => {
    const sender = makeMockSender();
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    await dispatcher.onStart();

    const result = await dispatcher.onHalt();
    expect(result.ok).toBe(true);
    expect(sender.stop).toHaveBeenCalledTimes(1);
  });

  it('undeploys and nulls out references', async () => {
    const sender = makeMockSender();
    const dispatcher = new DicomDispatcher(makeConfig(), makeMockFactory(sender));
    await dispatcher.onStart();

    const result = await dispatcher.onUndeploy();
    expect(result.ok).toBe(true);
  });

  it('stop succeeds when sender was never started', async () => {
    const dispatcher = new DicomDispatcher(makeConfig());
    const result = await dispatcher.onStop();
    expect(result.ok).toBe(true);
  });
});
