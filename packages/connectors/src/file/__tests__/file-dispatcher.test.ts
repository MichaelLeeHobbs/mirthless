import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileDispatcher, resolveOutputFilename, type FileDispatcherConfig } from '../file-dispatcher.js';
import type { ConnectorMessage } from '../../base.js';
import { isTempFileName } from '../../temp-file.js';
import { makeMockLogger } from '../../__fixtures__/mock-logger.js';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
  realpath: vi.fn(),
}));

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const mockWriteFile = vi.mocked(fs.writeFile);
const mockAppendFile = vi.mocked(fs.appendFile);
const mockRename = vi.mocked(fs.rename);
const mockUnlink = vi.mocked(fs.unlink);
const mockMkdir = vi.mocked(fs.mkdir);
const mockRealpath = vi.mocked(fs.realpath);

function makeConfig(overrides?: Partial<FileDispatcherConfig>): FileDispatcherConfig {
  return {
    directory: '/data/outbound',
    outputPattern: '${messageId}.txt',
    charset: 'utf-8',
    binary: false,
    tempFileEnabled: true,
    appendMode: false,
    roots: { allowed: ['/data'], denied: [] },
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

let dispatcher: FileDispatcher | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  mockMkdir.mockResolvedValue(undefined as never);
  // No symlinks unless a test says so: every path is its own real path.
  mockRealpath.mockImplementation(((p: string) => Promise.resolve(p)) as never);
  mockWriteFile.mockResolvedValue(undefined);
  mockAppendFile.mockResolvedValue(undefined);
  mockRename.mockResolvedValue(undefined);
  mockUnlink.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (dispatcher) {
    await dispatcher.onStop();
    await dispatcher.onUndeploy();
    dispatcher = null;
  }
});

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

  it('does not expand a placeholder that appears inside a substituted value', () => {
    const result = resolveOutputFilename(
      '${messageId}_${timestamp}.txt',
      { messageId: 'a${timestamp}', timestamp: '99' },
    );
    expect(result).toBe('a${timestamp}_99.txt');
  });

  it('inserts replacement-pattern characters in a value literally', () => {
    const result = resolveOutputFilename('${messageId}.txt', { messageId: "$& $1 $$ $'" });
    expect(result).toBe("$& $1 $$ $'.txt");
  });

  it('ignores inherited object keys as placeholder names', () => {
    expect(resolveOutputFilename('${toString}.txt', { messageId: '1' })).toBe('${toString}.txt');
  });
});

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

    it('refuses a pattern with a placeholder it cannot fill, naming it', async () => {
      dispatcher = new FileDispatcher(makeConfig({ outputPattern: '${originalFilename}.hl7' }));
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.message).toContain('${originalFilename}');
      expect(result.error.message).toContain('${messageId}');
    });

    it('refuses a character set it does not know instead of writing UTF-8', async () => {
      dispatcher = new FileDispatcher(makeConfig({ charset: 'windows-1252' as BufferEncoding }));
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.error.message).toContain('windows-1252');
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

      expect(mockMkdir).toHaveBeenCalledWith(path.resolve('/data/outbound'), { recursive: true });
    });

    // GHSA-r434-hwqg-cvcw: a File destination could overwrite the server's own code.
    it('refuses to deploy a directory outside FILE_CONNECTOR_ROOTS', async () => {
      dispatcher = new FileDispatcher(makeConfig({ directory: '/app/packages/server/dist' }));
      const result = await dispatcher.onDeploy();
      expect(result.ok).toBe(false);
      expect(result.error?.message).toMatch(/outside FILE_CONNECTOR_ROOTS/);
    });

    it('refuses to deploy when no roots are configured', async () => {
      dispatcher = new FileDispatcher(makeConfig({ roots: { allowed: [], denied: [] } }));
      const result = await dispatcher.onDeploy();
      expect(result.error?.message).toMatch(/FILE_CONNECTOR_ROOTS is not set/);
    });

    it('writes nothing when the file name pattern climbs out of the roots', async () => {
      dispatcher = new FileDispatcher(makeConfig({ outputPattern: '../../app/${messageId}.js', tempFileEnabled: false }));
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockAppendFile).not.toHaveBeenCalled();
    });

    it('writes nothing when the output file is a link out of the roots', async () => {
      mockRealpath.mockImplementation(((p: string) =>
        Promise.resolve(p === path.resolve('/data/outbound/42.txt') ? path.resolve('/app/.env') : p)) as never);
      dispatcher = new FileDispatcher(makeConfig({ appendMode: true }));
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
      expect(mockAppendFile).not.toHaveBeenCalled();
    });

    it('creates nothing when the directory has become a link out of the roots', async () => {
      mockRealpath.mockImplementation(((p: string) =>
        Promise.resolve(p === path.resolve('/data/outbound') ? path.resolve('/app') : p)) as never);
      dispatcher = new FileDispatcher(makeConfig());
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('writes file with temp-file-then-rename when tempFileEnabled', async () => {
      dispatcher = new FileDispatcher(makeConfig({ tempFileEnabled: true }));
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);

      const writePath = mockWriteFile.mock.calls[0]![0] as string;
      expect(writePath).toMatch(/\.tmp$/);

      expect(mockRename).toHaveBeenCalledTimes(1);
      const renameSrc = mockRename.mock.calls[0]![0] as string;
      const renameDst = mockRename.mock.calls[0]![1] as string;
      expect(renameSrc).toMatch(/\.tmp$/);
      expect(renameDst).not.toMatch(/\.tmp$/);
    });

    it('uses a different temp file for each write, so two messages for one file name cannot collide', async () => {
      dispatcher = new FileDispatcher(makeConfig({ tempFileEnabled: true, outputPattern: 'latest.txt' }));
      await dispatcher.onStart();

      await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
      await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));

      const first = mockWriteFile.mock.calls[0]![0] as string;
      const second = mockWriteFile.mock.calls[1]![0] as string;
      expect(first).not.toBe(second);
    });

    it('writes the temp file next to the file under a name no source reads', async () => {
      dispatcher = new FileDispatcher(makeConfig());
      await dispatcher.onStart();
      await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
      const written = mockWriteFile.mock.calls[0]![0] as string;
      expect(path.dirname(written)).toBe(path.resolve('/data/outbound'));
      expect(isTempFileName(path.basename(written))).toBe(true);
    });

    it('removes the temp file of a write that failed', async () => {
      mockWriteFile.mockRejectedValue(Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', syscall: 'write' }));
      dispatcher = new FileDispatcher(makeConfig());
      await dispatcher.onStart();
      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
      expect(result.ok).toBe(false);
      expect(mockUnlink).toHaveBeenCalledWith(mockWriteFile.mock.calls[0]![0]);
    });

    it.each([
      ['EPERM', 1],
      ['ENOENT', 0],
    ])('warns when the temp file of a failed write cannot be removed, unless there is none (%s)', async (code, count) => {
      const { logger, warnings } = makeMockLogger();
      mockRename.mockRejectedValue(new Error('EPERM: rename'));
      mockUnlink.mockRejectedValue(Object.assign(new Error(code), { code }));
      dispatcher = new FileDispatcher(makeConfig(), logger);
      await dispatcher.onStart();
      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain('EPERM: rename');
      expect(warnings.map((w) => w.obj['file'])).toEqual(count === 1 ? [mockWriteFile.mock.calls[0]![0]] : []);
    });

    it.each([
      ['append', { appendMode: true }],
      ['direct write', { tempFileEnabled: false }],
    ])('names the file that may hold part of the message when a %s is cut off', async (_label, overrides) => {
      const full = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', syscall: 'write' });
      mockAppendFile.mockRejectedValue(full);
      mockWriteFile.mockRejectedValue(full);
      dispatcher = new FileDispatcher(makeConfig(overrides));
      await dispatcher.onStart();
      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
      expect(result.error?.message).toBe(`ENOSPC: no space left on device, write; ${path.join(path.resolve('/data/outbound'), '42.txt')} may hold part of this message`);
    });

    it('says nothing of a partial file when the file could not be opened', async () => {
      mockAppendFile.mockRejectedValue(Object.assign(new Error('EACCES: permission denied, open'), { code: 'EACCES', syscall: 'open' }));
      dispatcher = new FileDispatcher(makeConfig({ appendMode: true }));
      await dispatcher.onStart();
      const result = await dispatcher.send(makeMessage(), AbortSignal.timeout(5_000));
      expect(result.error?.message).toBe('EACCES: permission denied, open');
    });

    it('warns at deploy when every message would write the same file', async () => {
      const { logger, warnings: warns } = makeMockLogger();
      dispatcher = new FileDispatcher(makeConfig({ outputPattern: 'latest.txt' }), logger);
      expect((await dispatcher.onDeploy()).ok).toBe(true);
      expect(warns.some((w) => w.msg.includes('overwrites'))).toBe(true);
    });

    it('does not warn when the name has the message id or the file is appended to', async () => {
      const { logger, warnings: warns } = makeMockLogger();
      await new FileDispatcher(makeConfig(), logger).onDeploy();
      await new FileDispatcher(makeConfig({ outputPattern: 'all.txt', appendMode: true }), logger).onDeploy();
      expect(warns).toHaveLength(0);
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
      expect(writeContent).toEqual(Buffer.from('Hello World'));
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
      expect(mockWriteFile.mock.calls[0]![2]).toBeUndefined();
    });

    it('writes text in the normalized configured charset', async () => {
      dispatcher = new FileDispatcher(makeConfig({
        charset: 'ISO-8859-1' as BufferEncoding,
        tempFileEnabled: false,
      }));
      await dispatcher.onStart();

      await dispatcher.send(makeMessage({ content: 'Café' }), AbortSignal.timeout(5_000));

      expect(mockWriteFile.mock.calls[0]![1]).toEqual(Buffer.from([0x43, 0x61, 0x66, 0xe9]));
    });

    it('appends text in the normalized configured charset', async () => {
      dispatcher = new FileDispatcher(makeConfig({
        charset: 'ISO-8859-1' as BufferEncoding,
        appendMode: true,
      }));
      await dispatcher.onStart();

      await dispatcher.send(makeMessage({ content: 'Café' }), AbortSignal.timeout(5_000));

      expect(mockAppendFile.mock.calls[0]![1]).toEqual(Buffer.from([0x43, 0x61, 0x66, 0xe9]));
    });

    it.each([
      ['a temporary file', {}],
      ['the file itself', { tempFileEnabled: false }],
      ['an append', { appendMode: true }],
    ])('writes nothing when the charset cannot hold the message: %s (#415)', async (_how, overrides) => {
      dispatcher = new FileDispatcher(makeConfig({ charset: 'ISO-8859-1' as BufferEncoding, ...overrides }));
      await dispatcher.onStart();

      const result = await dispatcher.send(makeMessage({ content: 'PID|1||DOE\u2019S' }), AbortSignal.timeout(5_000));

      expect(result.ok).toBe(false);
      expect(result.error?.message).toBe('The text holds the character U+2019, which the charset latin1 does not have');
      expect(mockMkdir).not.toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(mockAppendFile).not.toHaveBeenCalled();
    });

    it('appends base64 decoded bytes with no encoding in binary mode', async () => {
      dispatcher = new FileDispatcher(makeConfig({ binary: true, appendMode: true }));
      await dispatcher.onStart();

      const binaryBase64 = Buffer.from([0x00, 0x01, 0xFF]).toString('base64');
      await dispatcher.send(makeMessage({ content: binaryBase64 }), AbortSignal.timeout(5_000));

      const appended = mockAppendFile.mock.calls[0]![1];
      expect(Buffer.isBuffer(appended)).toBe(true);
      expect(appended).toEqual(Buffer.from([0x00, 0x01, 0xFF]));
      expect(mockAppendFile.mock.calls[0]![2]).toBeUndefined();
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
