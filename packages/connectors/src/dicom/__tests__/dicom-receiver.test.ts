// ===========================================
// DICOM Receiver Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { stderr, type Result } from '@galvanigraph/core-util';
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
    aeTitle: 'GALVANIGRAPH',
    connectionTimeoutMs: 10_000,
    dispatchMode: 'PER_FILE',
    postAction: 'DELETE',
    moveToDirectory: '',
    roots: { allowed: ['/data', os.tmpdir()], denied: [] },
    ...overrides,
  };
}

function makeFileData(overrides?: Partial<DcmtkFileData>): DcmtkFileData {
  return {
    filePath: '/data/dicom/assoc-1/image.dcm',
    associationId: 'assoc-1',
    associationDir: '/data/dicom/assoc-1',
    callingAE: 'SCANNER',
    calledAE: 'GALVANIGRAPH',
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
    calledAE: 'GALVANIGRAPH',
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
  start: Mock<DcmtkReceiver['start']>;
  stop: Mock<DcmtkReceiver['stop']>;
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
    start: vi.fn<DcmtkReceiver['start']>(async () => ({ ok: true as const, value: undefined as void, error: null })),
    stop: vi.fn<DcmtkReceiver['stop']>(async () => {}),
  };
  return mock;
}

function makeMockFactory(mock: MockReceiver): ReceiverFactory {
  return () => ({ ok: true as const, value: mock, error: null });
}

function makeFailingFactory(message: string): ReceiverFactory {
  return () => ({ ok: false as const, value: null, error: stderr(message) });
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

  // #313: a deployer could point the listener at any directory the server can write.
  it.each([
    ['storageDir is outside the roots', { storageDir: '/etc/galvanigraph' }, 'outside FILE_CONNECTOR_ROOTS'],
    ['storageDir is relative', { storageDir: 'data/dicom' }, 'must be absolute'],
    ['moveToDirectory is outside the roots', { postAction: 'MOVE', moveToDirectory: '/srv/app' }, 'outside FILE_CONNECTOR_ROOTS'],
    ['storageDir is in a denied directory', { roots: { allowed: ['/data'], denied: ['/data/dicom'] } }, "server's own directories"],
    ['no roots are set', { roots: { allowed: [], denied: [] } }, 'FILE_CONNECTOR_ROOTS is not set'],
  ] as const)('fails when %s', async (_case, overrides, message) => {
    const receiver = new DicomReceiver(makeConfig(overrides as Partial<DicomReceiverConfig>));
    const result = await receiver.onDeploy();
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toContain(message);
  });

  it('ignores moveToDirectory when the post-action is not MOVE', async () => {
    const receiver = new DicomReceiver(makeConfig({ postAction: 'DELETE', moveToDirectory: '/srv/app' }));
    expect((await receiver.onDeploy()).ok).toBe(true);
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
    mock.start.mockResolvedValue({ ok: false, value: null, error: stderr('Start failed') });
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
    expect(raw.sourceMap['calledAE']).toBe('GALVANIGRAPH');
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
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-receiver-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function storedFile(name: string): Promise<string> {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, 'DICM');
    return filePath;
  }

  async function exists(filePath: string): Promise<boolean> {
    return fs.access(filePath).then(() => true, () => false);
  }

  async function receiveFile(filePath: string, response: Result<DispatchResult>, overrides?: Partial<DicomReceiverConfig>): Promise<DicomReceiver> {
    const mock = makeMockReceiver();
    const dispatcher = makeDispatcher(response);
    const receiver = new DicomReceiver(makeConfig({ storageDir: dir, ...overrides }), makeMockFactory(mock));
    receiver.setDispatcher(dispatcher);
    await receiver.onStart();
    mock.fileHandler!(makeFileData({ filePath }));
    await vi.waitFor(() => { expect(dispatcher).toHaveBeenCalledTimes(1); });
    return receiver;
  }

  it('deletes the file once every destination has it', async () => {
    const filePath = await storedFile('a.dcm');
    await receiveFile(filePath, { ok: true, value: { messageId: 1, status: 'PROCESSED' }, error: null });
    await vi.waitFor(async () => { expect(await exists(filePath)).toBe(false); });
  });

  it('keeps the file when dispatch fails', async () => {
    const filePath = await storedFile('a.dcm');
    await receiveFile(filePath, { ok: false, value: null, error: stderr('Dispatch failed') });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(await exists(filePath)).toBe(true);
  });

  it('keeps the file while a queued destination waits, and deletes it when the queue delivers', async () => {
    const filePath = await storedFile('a.dcm');
    const receiver = await receiveFile(filePath, { ok: true, value: { messageId: 1, status: 'PROCESSED', queued: true }, error: null });
    await new Promise((r) => { setTimeout(r, 50); });
    expect(await exists(filePath)).toBe(true);

    await receiver.onMessageDelivered(filePath);
    expect(await exists(filePath)).toBe(false);
  });

  it('moves every file of a queued association when the queue delivers', async () => {
    const files = [await storedFile('1.dcm'), await storedFile('2.dcm')];
    const moveTo = path.join(dir, 'done');
    const mock = makeMockReceiver();
    const dispatcher = makeDispatcher({ ok: true, value: { messageId: 1, queued: true }, error: null });
    const receiver = new DicomReceiver(
      makeConfig({ storageDir: dir, dispatchMode: 'PER_ASSOCIATION', postAction: 'MOVE', moveToDirectory: moveTo }),
      makeMockFactory(mock),
    );
    receiver.setDispatcher(dispatcher);
    await receiver.onStart();
    mock.assocHandler!(makeAssociationData({ files }));
    await vi.waitFor(() => { expect(dispatcher).toHaveBeenCalledTimes(1); });
    expect(await exists(files[0]!)).toBe(true);

    await receiver.onMessageDelivered(JSON.stringify(files));
    expect(await fs.readdir(moveTo)).toEqual(['1.dcm', '2.dcm']);
    expect(await exists(files[0]!)).toBe(false);
  });

  it('touches nothing when the delivered content is not a path or a list of paths', async () => {
    const filePath = await storedFile('a.dcm');
    const receiver = new DicomReceiver(makeConfig({ storageDir: dir }));
    await receiver.onMessageDelivered('[not json');
    await receiver.onMessageDelivered('{"a":1}');
    expect(await exists(filePath)).toBe(true);
  });

  // #313: the path comes back from the stored message, so it is checked again.
  it('deletes nothing outside the storage directory', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dicom-outside-'));
    const victim = path.join(outside, 'keep.dcm');
    await fs.writeFile(victim, 'DICM');
    try {
      const receiver = new DicomReceiver(makeConfig({ storageDir: dir }));
      await receiver.onMessageDelivered(victim);
      await receiver.onMessageDelivered(path.join(dir, '..', path.basename(outside), 'keep.dcm'));
      expect(await exists(victim)).toBe(true);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('moves nothing into a directory outside the roots', async () => {
    const filePath = await storedFile('a.dcm');
    const receiver = new DicomReceiver(makeConfig({
      storageDir: dir,
      postAction: 'MOVE',
      moveToDirectory: '/srv/not-allowed',
      roots: { allowed: [dir], denied: [] },
    }));
    await receiver.onMessageDelivered(filePath);
    expect(await exists(filePath)).toBe(true);
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
