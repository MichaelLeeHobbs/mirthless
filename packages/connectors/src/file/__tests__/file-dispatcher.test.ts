// ===========================================
// File Dispatcher Tests
// ===========================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileDispatcher, resolveOutputFilename, type FileDispatcherConfig } from '../file-dispatcher.js';
import type { ConnectorMessage } from '../../base.js';

// ----- Mock node:fs/promises -----

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

import * as fs from 'node:fs/promises';

const mockWriteFile = vi.mocked(fs.writeFile);
const mockAppendFile = vi.mocked(fs.appendFile);
const mockRename = vi.mocked(fs.rename);
const mockMkdir = vi.mocked(fs.mkdir);

// ----- Helpers -----

function makeConfig(overrides?: Partial<FileDispatcherConfig>): FileDispatcherConfig {
  return {
    directory: '/data/outbound',
    outputPattern: '${messageId}.txt',
    charset: 'utf-8',
    binary: false,
    tempFileEnabled: true,
    appendMode: false,
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<ConnectorMessage>): ConnectorMessage {
  return {
    channelId: '00000000-0000-0000-0000-000000000001',
    messageId: 42,
    metaDataId: 1,
    content: 'MSH|^~\\&|SENDER',
    dataType: 'HL7V2',
    ...overrides,
  };
}

// ----- Lifecycle -----

let dispatcher: FileDispatcher | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined as never);
  mockWriteFile.mockResolvedValue(undefined);
  mockAppendFile.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (dispatcher) {
    await dispatcher.onStop();
    await dispatcher.onUndeploy();
    dispatcher = null;
  }
});

// ----- resolveOutputFilename Tests -----

describe('resolveOutputFilename', () => {
  it('substitutes messageId', () => {
    const result = resolveOutputFilename('${messageId}.txt', { messageId: '42' });
    expect(result).toBe('42.txt');
  });

  it('substitutes multiple placeholders', () => {
    const result = resolveOutputFilename(
      '${messageId}_${timestamp}.txt',
      { messageId: '42', timestamp: '1234567890' },
    );
    expect(result).toBe('42_1234567890.txt');
  });

  it('leaves unknown placeholders untouched', () => {
    const result = resolveOutputFilename('${unknown}.txt', { messageId: '42' });
    expect(result).toBe('${unknown}.txt');
  });

  it('returns pattern as-is when no placeholders', () => {
    const result = resolveOutputFilename('output.txt', { messageId: '42' });
    expect(result).toBe('output.txt');
  });

  it('substitutes same placeholder multiple times', () => {
    const result = resolveOutputFilename('${messageId}_${messageId}.txt', { messageId: '5' });
    expect(result).toBe('5_5.txt');
  });
});

// ----- FileDispatcher Tests -----

describe('FileDispatcher', () => {
  describe('onDeploy', () => {
    it('validates directory is required', async () => {
      dispatcher = new FileDispatcher(makeConfig({ directory: '' }));
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('validates output pattern is required', async () => {
      dispatcher = new FileDispatcher(makeConfig({ outputPattern: '' }));
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(false);
    });

    it('deploys with valid config', async () => {
      dispatcher = new FileDispatcher(makeConfig());
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(true);
    });
  });

  describe('onStart / onStop', () => {
    it('starts and stops without error', async () => {
      dispatcher = new FileDispatcher(makeConfig());
      const startResult = await dispatcher.onStart();
      expect(startResult.ok).toBe(true);

      const stopResult = await dispatcher.onStop();
      expect(stopResult.ok).toBe(true);

      dispatcher = null;
    });
  });

  describe('send', () => {
    it('errors when dispatcher not started', async () => {
      dispatcher = new FileDispatcher(makeConfig());

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
    });

    it('errors when signal is already aborted', async () => {
      dispatcher = new FileDispatcher(makeConfig());
      await dispatcher.onStart();

      const controller = new AbortController();
      controller.abort();

      const result = await dispatcher.send(makeMessage(), controller.signal);

      expect(result.ok).toBe(false);
    });

    it('creates output directory if needed', async () => {
      dispatcher = new FileDispatcher(makeConfig());
      await dispatcher.onStart();

      await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(mockMkdir).toHaveBeenCalledWith('/data/outbound', { recursive: true });
    });

    it('writes file with temp-file-then-rename when tempFileEnabled', async () => {
      dispatcher = new FileDispatcher(makeConfig({ tempFileEnabled: true }));
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);

      // Should write to .tmp first
      const writePath = mockWriteFile.mock.calls[0]![0] as string;
      expect(writePath).toMatch(/\.tmp$/);

      // Then rename
      expect(mockRename).toHaveBeenCalledTimes(1);
      const renameSrc = mockRename.mock.calls[0]![0] as string;
      const renameDst = mockRename.mock.calls[0]![1] as string;
      expect(renameSrc).toMatch(/\.tmp$/);
      expect(renameDst).not.toMatch(/\.tmp$/);
    });

    it('writes file directly when tempFileEnabled is false', async () => {
      dispatcher = new FileDispatcher(makeConfig({ tempFileEnabled: false }));
      await dispatcher.onStart();

      await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const writePath = mockWriteFile.mock.calls[0]![0] as string;
      expect(writePath).not.toMatch(/\.tmp$/);
      expect(mockRename).not.toHaveBeenCalled();
    });

    it('uses appendFile when appendMode is true', async () => {
      dispatcher = new FileDispatcher(makeConfig({ appendMode: true }));
      await dispatcher.onStart();

      await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(mockAppendFile).toHaveBeenCalledTimes(1);
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockRename).not.toHaveBeenCalled();
    });

    it('substitutes messageId in output pattern', async () => {
      dispatcher = new FileDispatcher(makeConfig({
        outputPattern: 'msg_${messageId}.hl7',
        tempFileEnabled: false,
      }));
      await dispatcher.onStart();

      await dispatcher.send(makeMessage({ messageId: 99 }), AbortSignal.timeout(5_000));

      const writePath = mockWriteFile.mock.calls[0]![0] as string;
      expect(writePath).toContain('msg_99.hl7');
    });

    it('returns output path in response content', async () => {
      dispatcher = new FileDispatcher(makeConfig({ tempFileEnabled: false }));
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.status).toBe('SENT');
      expect(result.value.content).toContain('data');
      expect(result.value.content).toContain('outbound');
    });

    it('writes content as-is in text mode', async () => {
      dispatcher = new FileDispatcher(makeConfig({ tempFileEnabled: false }));
      await dispatcher.onStart();

      await dispatcher.send(
        makeMessage({ content: 'Hello World' }),
        AbortSignal.timeout(5_000),
      );

      const writeContent = mockWriteFile.mock.calls[0]![1];
      expect(writeContent).toBe('Hello World');
    });

    it('writes base64 decoded content in binary mode', async () => {
      dispatcher = new FileDispatcher(makeConfig({
        binary: true,
        tempFileEnabled: false,
      }));
      await dispatcher.onStart();

      const binaryBase64 = Buffer.from([0x00, 0x01, 0xFF]).toString('base64');
      await dispatcher.send(
        makeMessage({ content: binaryBase64 }),
        AbortSignal.timeout(5_000),
      );

      const writeContent = mockWriteFile.mock.calls[0]![1];
      expect(Buffer.isBuffer(writeContent)).toBe(true);
      expect(writeContent).toEqual(Buffer.from([0x00, 0x01, 0xFF]));
    });
  });

  describe('lifecycle', () => {
    it('halt stops the dispatcher', async () => {
      dispatcher = new FileDispatcher(makeConfig());
      await dispatcher.onStart();

      const haltResult = await dispatcher.onHalt();
      expect(haltResult.ok).toBe(true);

      dispatcher = null;
    });

    it('undeploy stops the dispatcher', async () => {
      dispatcher = new FileDispatcher(makeConfig());
      await dispatcher.onStart();

      const undeployResult = await dispatcher.onUndeploy();
      expect(undeployResult.ok).toBe(true);

      dispatcher = null;
    });
  });
});
