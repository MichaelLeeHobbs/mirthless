// ===========================================
// DICOM Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Result } from '@mirthless/core-util';
import type { MessageDispatcher, RawMessage, DispatchResult } from '../../base.js';
import {
  DicomReceiver,
  type DicomReceiverConfig,
  type DcmtkReceiver,
  type DcmtkFileData,
  type DcmtkAssociationData,
  type ReceiverFactory,
} from '../dicom-receiver.js';

// ----- Helpers -----

function makeConfig(overrides?: Partial<DicomReceiverConfig>): DicomReceiverConfig {
  return {
    port: 4242,
    storageDir: '/data/dicom',
    aeTitle: 'MIRTHLESS',
    minPoolSize: 2,
    maxPoolSize: 10,
    connectionTimeoutMs: 10_000,
    dispatchMode: 'PER_FILE',
    postAction: 'DELETE',
    moveToDirectory: '',
    ...overrides,
  };
}

function makeFileData(overrides?: Partial<DcmtkFileData>): DcmtkFileData {
  return {
    filePath: '/data/dicom/assoc-1/image.dcm',
    associationId: 'assoc-1',
    associationDir: '/data/dicom/assoc-1',
    callingAE: 'SCANNER',
    calledAE: 'MIRTHLESS',
    source: '192.168.1.10:4242',
    instance: {
      dataset: {
        patientName: 'DOE^JOHN',
        patientID: 'P12345',
        studyInstanceUID: '1.2.3.4.5',
        modality: 'CT',
      },
    },
    ...overrides,
  };
}

function makeAssociationData(overrides?: Partial<DcmtkAssociationData>): DcmtkAssociationData {
  return {
    associationId: 'assoc-1',
    associationDir: '/data/dicom/assoc-1',
    callingAE: 'SCANNER',
    calledAE: 'MIRTHLESS',
    source: '192.168.1.10:4242',
    files: ['/data/dicom/assoc-1/img1.dcm', '/data/dicom/assoc-1/img2.dcm'],
    durationMs: 500,
    ...overrides,
  };
}

interface MockReceiver extends DcmtkReceiver {
  fileHandler: ((data: DcmtkFileData) => void) | null;
  assocHandler: ((data: DcmtkAssociationData) => void) | null;
  errorHandler: ((data: { readonly error: Error }) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeMockReceiver(): MockReceiver {
  const mock: MockReceiver = {
    fileHandler: null,
    assocHandler: null,
    errorHandler: null,
    onFileReceived(listener) { mock.fileHandler = listener; },
    onAssociationComplete(listener) { mock.assocHandler = listener; },
    onEvent(event, listener) {
      if (event === 'error') mock.errorHandler = listener;
    },
    start: vi.fn(async () => ({ ok: true as const, value: undefined as void, error: null })),
    stop: vi.fn(async () => {}),
  };
  return mock;
}

function makeMockFactory(mock: MockReceiver): ReceiverFactory {
  return () => ({ ok: true as const, value: mock, error: null });
}

function makeFailingFactory(message: string): ReceiverFactory {
  return () => ({ ok: false as const, value: null, error: new Error(message) });
}

function makeDispatcher(response?: Result<DispatchResult>): MessageDispatcher {
  const defaultResponse: Result<DispatchResult> = {
    ok: true,
    value: { messageId: 1 },
    error: null,
  };
  return vi.fn(async () => response ?? defaultResponse);
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
});

// ----- onDeploy -----

describe('DicomReceiver.onDeploy', () => {
  it('succeeds with valid config', async () => {
    const receiver = new DicomReceiver(makeConfig());
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(true);
  });

  it('fails when port is out of range (0)', async () => {
    const receiver = new DicomReceiver(makeConfig({ port: 0 }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when port is out of range (70000)', async () => {
    const receiver = new DicomReceiver(makeConfig({ port: 70000 }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when storageDir is empty', async () => {
    const receiver = new DicomReceiver(makeConfig({ storageDir: '' }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when aeTitle exceeds 16 characters', async () => {
    const receiver = new DicomReceiver(makeConfig({ aeTitle: 'A'.repeat(17) }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when minPoolSize is less than 1', async () => {
    const receiver = new DicomReceiver(makeConfig({ minPoolSize: 0 }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when maxPoolSize is less than minPoolSize', async () => {
    const receiver = new DicomReceiver(makeConfig({ minPoolSize: 5, maxPoolSize: 3 }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('fails when postAction is MOVE but moveToDirectory is empty', async () => {
    const receiver = new DicomReceiver(makeConfig({ postAction: 'MOVE', moveToDirectory: '' }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
  });

  it('succeeds when postAction is MOVE with valid moveToDirectory', async () => {
    const receiver = new DicomReceiver(makeConfig({ postAction: 'MOVE', moveToDirectory: '/data/processed' }));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(true);
  });
});

// ----- onStart -----

describe('DicomReceiver.onStart', () => {
  it('fails when dispatcher is not set', async () => {
    const mock = makeMockReceiver();
    const receiver = new DicomReceiver(makeConfig(), makeMockFactory(mock));
    const result = await receiver.onStart();
    expect(result.ok).toBe(false);
  });

  it('creates underlying receiver and starts it', async () => {
    const mock = makeMockReceiver();
    const receiver = new DicomReceiver(makeConfig(), makeMockFactory(mock));
    receiver.setDispatcher(makeDispatcher());
    const result = await receiver.onStart();
    expect(result.ok).toBe(true);
    expect(mock.start).toHaveBeenCalledTimes(1);
  });

  it('fails when factory returns error', async () => {
    const receiver = new DicomReceiver(makeConfig(), makeFailingFactory('Factory failed'));
    receiver.setDispatcher(makeDispatcher());
    const result = await receiver.onStart();
    expect(result.ok).toBe(false);
  });

  it('fails when underlying start fails', async () => {
    const mock = makeMockReceiver();
    mock.start.mockResolvedValue({ ok: false, value: null, error: new Error('Start failed') });
    const receiver = new DicomReceiver(makeConfig(), makeMockFactory(mock));
    receiver.setDispatcher(makeDispatcher());
    const result = await receiver.onStart();
    expect(result.ok).toBe(false);
  });
});

// ----- FILE_RECEIVED dispatch (PER_FILE mode) -----

describe('DicomReceiver PER_FILE dispatch', () => {
  it('dispatches with filePath as content and metadata in sourceMap', async () => {
    const mock = makeMockReceiver();
    const dispatcher = makeDispatcher();
    const receiver = new DicomReceiver(makeConfig(), makeMockFactory(mock));
    receiver.setDispatcher(dispatcher);
    await receiver.onStart();

    const fileData = makeFileData();
    mock.fileHandler!(fileData);

    // Allow async handler to complete
    await vi.waitFor(() => {
      expect(dispatcher).toHaveBeenCalledTimes(1);
    });

    const raw = (dispatcher as ReturnType<typeof vi.fn>).mock.calls[0]![0] as RawMessage;
    expect(raw.content).toBe('/data/dicom/assoc-1/image.dcm');
    expect(raw.sourceMap['patientName']).toBe('DOE^JOHN');
    expect(raw.sourceMap['patientID']).toBe('P12345');
    expect(raw.sourceMap['studyInstanceUID']).toBe('1.2.3.4.5');
    expect(raw.sourceMap['callingAE']).toBe('SCANNER');
    expect(raw.sourceMap['calledAE']).toBe('MIRTHLESS');
    expect(raw.sourceMap['associationId']).toBe('assoc-1');
  });

  it('does not dispatch when dispatcher is null', async () => {
    const mock = makeMockReceiver();
    const receiver = new DicomReceiver(makeConfig(), makeMockFactory(mock));
    const dispatcher = makeDispatcher();
    receiver.setDispatcher(dispatcher);
    await receiver.onStart();

    // Undeploy clears dispatcher
    await receiver.onUndeploy();

    mock.fileHandler!(makeFileData());
    // Give time for any async operations
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(dispatcher).not.toHaveBeenCalled();
  });
});

// ----- PER_ASSOCIATION mode -----

describe('DicomReceiver PER_ASSOCIATION dispatch', () => {
  it('dispatches association data as JSON array content', async () => {
    const mock = makeMockReceiver();
    const dispatcher = makeDispatcher();
    const receiver = new DicomReceiver(
      makeConfig({ dispatchMode: 'PER_ASSOCIATION' }),
      makeMockFactory(mock),
    );
    receiver.setDispatcher(dispatcher);
    await receiver.onStart();

    const assocData = makeAssociationData();
    mock.assocHandler!(assocData);

    await vi.waitFor(() => {
      expect(dispatcher).toHaveBeenCalledTimes(1);
    });

    const raw = (dispatcher as ReturnType<typeof vi.fn>).mock.calls[0]![0] as RawMessage;
    const files = JSON.parse(raw.content) as string[];
    expect(files).toHaveLength(2);
    expect(raw.sourceMap['callingAE']).toBe('SCANNER');
    expect(raw.sourceMap['fileCount']).toBe(2);
    expect(raw.sourceMap['durationMs']).toBe(500);
  });
});

// ----- Post-action -----

describe('DicomReceiver post-action', () => {
  it('does not apply post-action when dispatch fails', async () => {
    const mock = makeMockReceiver();
    const failResult: Result<DispatchResult> = {
      ok: false,
      value: null,
      error: new Error('Dispatch failed'),
    };
    const dispatcher = makeDispatcher(failResult);
    const receiver = new DicomReceiver(
      makeConfig({ postAction: 'NONE' }),
      makeMockFactory(mock),
    );
    receiver.setDispatcher(dispatcher);
    await receiver.onStart();

    mock.fileHandler!(makeFileData());
    await vi.waitFor(() => {
      expect(dispatcher).toHaveBeenCalledTimes(1);
    });
    // No error thrown — post-action is skipped
  });
});

// ----- Lifecycle -----

describe('DicomReceiver lifecycle', () => {
  it('stops the underlying receiver', async () => {
    const mock = makeMockReceiver();
    const receiver = new DicomReceiver(makeConfig(), makeMockFactory(mock));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();

    const result = await receiver.onStop();
    expect(result.ok).toBe(true);
    expect(mock.stop).toHaveBeenCalledTimes(1);
  });

  it('halts the underlying receiver', async () => {
    const mock = makeMockReceiver();
    const receiver = new DicomReceiver(makeConfig(), makeMockFactory(mock));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();

    const result = await receiver.onHalt();
    expect(result.ok).toBe(true);
    expect(mock.stop).toHaveBeenCalledTimes(1);
  });

  it('undeploys and nulls out references', async () => {
    const mock = makeMockReceiver();
    const receiver = new DicomReceiver(makeConfig(), makeMockFactory(mock));
    receiver.setDispatcher(makeDispatcher());
    await receiver.onStart();

    const result = await receiver.onUndeploy();
    expect(result.ok).toBe(true);
  });

  it('stop succeeds when receiver was never started', async () => {
    const receiver = new DicomReceiver(makeConfig());
    const result = await receiver.onStop();
    expect(result.ok).toBe(true);
  });
});
