// ===========================================
// Batch Processor Tests
// ===========================================

import { describe, it, expect, vi } from 'vitest';
import { BatchProcessor, BATCH_MODE, type BatchConfig } from '../batch-processor.js';
import type { SandboxExecutor, CompiledScript, ExecutionOptions, ExecutionResult } from '../../sandbox/sandbox-executor.js';
import type { Result } from '@mirthless/core-util';

// ----- Helpers -----

function makeSandbox(returnValue: unknown): SandboxExecutor {
  return {
    execute: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        returnValue,
        mapUpdates: { channelMap: {}, connectorMap: {}, globalChannelMap: {} },
        logs: [],
      } satisfies ExecutionResult,
      error: null,
    } satisfies Result<ExecutionResult>),
    dispose: vi.fn(),
  };
}

const EXEC_OPTIONS: ExecutionOptions = {
  timeout: 5000,
  memoryLimit: 128,
  signal: new AbortController().signal,
};

const SCRIPT: CompiledScript = { code: 'return msg.split("\\n");' };

// ----- Tests -----

describe('BatchProcessor', () => {
  describe('DISABLED mode', () => {
    it('returns original content as single-element array', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.DISABLED };

      const result = await processor.split('hello world', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['hello world']);
    });
  });

  describe('empty input', () => {
    it('returns empty array for empty content', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_DELIMITER, delimiter: '\n' };

      const result = await processor.split('', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });
  });

  describe('SPLIT_BY_DELIMITER mode', () => {
    it('splits HL7 batch by MSH delimiter', async () => {
      const processor = new BatchProcessor();
      const content = 'MSH|first\nMSH|second';
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_DELIMITER, delimiter: '\nMSH|' };

      const result = await processor.split(content, config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['MSH|first', 'second']);
    });

    it('splits by newline', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_DELIMITER, delimiter: '\n' };

      const result = await processor.split('line1\nline2\nline3', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['line1', 'line2', 'line3']);
    });

    it('returns single message when delimiter not found', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_DELIMITER, delimiter: '---' };

      const result = await processor.split('no delimiter here', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['no delimiter here']);
    });

    it('filters empty segments', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_DELIMITER, delimiter: '\n' };

      const result = await processor.split('a\n\nb', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['a', 'b']);
    });

    it('returns original when delimiter is empty', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_DELIMITER, delimiter: '' };

      const result = await processor.split('content', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['content']);
    });
  });

  describe('SPLIT_BY_REGEX mode', () => {
    it('splits by regex pattern', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_REGEX, regexPattern: '\\d+' };

      const result = await processor.split('a1b2c', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['a', 'b', 'c']);
    });

    it('returns original when pattern is empty', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_REGEX, regexPattern: '' };

      const result = await processor.split('content', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['content']);
    });

    it('splits HL7 batch by MSH regex', async () => {
      const processor = new BatchProcessor();
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_REGEX, regexPattern: '\\r?\\nMSH\\|' };

      const result = await processor.split('MSH|first\nMSH|second', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toHaveLength(2);
    });
  });

  describe('SPLIT_BY_JAVASCRIPT mode', () => {
    it('uses sandbox return value as split result', async () => {
      const sandbox = makeSandbox(['msg1', 'msg2', 'msg3']);
      const processor = new BatchProcessor({ sandbox, execOptions: EXEC_OPTIONS });
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_JAVASCRIPT, script: SCRIPT };

      const result = await processor.split('raw content', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['msg1', 'msg2', 'msg3']);
    });

    it('filters non-string values from result', async () => {
      const sandbox = makeSandbox(['valid', 42, null, 'also-valid', '']);
      const processor = new BatchProcessor({ sandbox, execOptions: EXEC_OPTIONS });
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_JAVASCRIPT, script: SCRIPT };

      const result = await processor.split('raw', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['valid', 'also-valid']);
    });

    it('returns original when sandbox returns non-array', async () => {
      const sandbox = makeSandbox('not an array');
      const processor = new BatchProcessor({ sandbox, execOptions: EXEC_OPTIONS });
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_JAVASCRIPT, script: SCRIPT };

      const result = await processor.split('content', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['content']);
    });

    it('returns original when no script provided', async () => {
      const sandbox = makeSandbox([]);
      const processor = new BatchProcessor({ sandbox, execOptions: EXEC_OPTIONS });
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_JAVASCRIPT };

      const result = await processor.split('content', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['content']);
    });

    it('returns original when sandbox execution fails', async () => {
      const sandbox: SandboxExecutor = {
        execute: vi.fn().mockResolvedValue({
          ok: false,
          value: null,
          error: new Error('Script error'),
        }),
        dispose: vi.fn(),
      };
      const processor = new BatchProcessor({ sandbox, execOptions: EXEC_OPTIONS });
      const config: BatchConfig = { mode: BATCH_MODE.SPLIT_BY_JAVASCRIPT, script: SCRIPT };

      const result = await processor.split('content', config);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(['content']);
    });
  });
});
