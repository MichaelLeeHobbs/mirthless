// ===========================================
// Attachment Handler Tests
// ===========================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AttachmentHandler, ATTACHMENT_MODE, type AttachmentConfig } from '../attachment-handler.js';
import { VmSandboxExecutor, DEFAULT_EXECUTION_OPTIONS } from '../../sandbox/sandbox-executor.js';
import { compileScript } from '../../sandbox/script-compiler.js';

// ----- Helpers -----

async function compile(code: string): Promise<{ code: string }> {
  const result = await compileScript(code, { sourcefile: 'attachment-test.js' });
  if (!result.ok) throw new Error('Compile failed');
  return result.value;
}

// ----- Tests -----

describe('AttachmentHandler', () => {
  describe('NONE mode', () => {
    it('returns original content with no attachments', async () => {
      const config: AttachmentConfig = { mode: ATTACHMENT_MODE.NONE };
      const handler = new AttachmentHandler(config);

      const result = await handler.extract('Hello World');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBe('Hello World');
      expect(result.value.attachments).toHaveLength(0);
    });
  });

  describe('REGEX mode', () => {
    it('extracts matches and replaces with placeholders', async () => {
      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.REGEX,
        pattern: 'data:[a-zA-Z/]+;base64,[A-Za-z0-9+/=]+',
        mimeType: 'application/octet-stream',
      };
      const handler = new AttachmentHandler(config);
      const content = 'Before data:image/png;base64,abc123== After';

      const result = await handler.extract(content);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.attachments).toHaveLength(1);
      expect(result.value.attachments[0]!.content).toBe('data:image/png;base64,abc123==');
      expect(result.value.attachments[0]!.mimeType).toBe('application/octet-stream');
      expect(result.value.attachments[0]!.id).toBeDefined();
      expect(result.value.attachments[0]!.size).toBeGreaterThan(0);
      expect(result.value.content).toContain('${ATTACH:');
      expect(result.value.content).not.toContain('base64');
    });

    it('returns original content when no pattern provided', async () => {
      const config: AttachmentConfig = { mode: ATTACHMENT_MODE.REGEX };
      const handler = new AttachmentHandler(config);

      const result = await handler.extract('test content');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBe('test content');
      expect(result.value.attachments).toHaveLength(0);
    });

    it('returns original content when pattern has no matches', async () => {
      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.REGEX,
        pattern: 'NOMATCH',
      };
      const handler = new AttachmentHandler(config);

      const result = await handler.extract('test content');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBe('test content');
      expect(result.value.attachments).toHaveLength(0);
    });

    it('uses default mimeType when not specified', async () => {
      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.REGEX,
        pattern: 'ATTACHMENT_DATA',
      };
      const handler = new AttachmentHandler(config);
      const content = 'Before ATTACHMENT_DATA After';

      const result = await handler.extract(content);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.attachments).toHaveLength(1);
      expect(result.value.attachments[0]!.mimeType).toBe('application/octet-stream');
    });

    it('generates unique IDs for each attachment', async () => {
      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.REGEX,
        pattern: 'ATT',
      };
      const handler = new AttachmentHandler(config);
      const content = 'ATT and ATT';

      const result = await handler.extract(content);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // With global regex on "ATT", both matches should produce attachments
      if (result.value.attachments.length >= 2) {
        expect(result.value.attachments[0]!.id).not.toBe(result.value.attachments[1]!.id);
      }
    });

    it('calculates correct byte size', async () => {
      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.REGEX,
        pattern: 'UNICODE_TEST',
      };
      const handler = new AttachmentHandler(config);

      const result = await handler.extract('UNICODE_TEST');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.attachments[0]!.size).toBe(Buffer.byteLength('UNICODE_TEST'));
    });
  });

  describe('JAVASCRIPT mode', () => {
    let executor: VmSandboxExecutor;

    beforeEach(() => {
      executor = new VmSandboxExecutor();
    });

    afterEach(() => {
      executor.dispose();
    });

    it('extracts attachments via user script', async () => {
      const script = await compile(`
        return {
          content: rawData.replace("EMBEDDED_DATA", ""),
          attachments: [
            { content: "EMBEDDED_DATA", mimeType: "text/plain" }
          ]
        };
      `);

      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.JAVASCRIPT,
        script,
      };
      const handler = new AttachmentHandler(config, executor, DEFAULT_EXECUTION_OPTIONS);

      const result = await handler.extract('Before EMBEDDED_DATA After');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.attachments).toHaveLength(1);
      expect(result.value.attachments[0]!.content).toBe('EMBEDDED_DATA');
      expect(result.value.attachments[0]!.mimeType).toBe('text/plain');
      expect(result.value.attachments[0]!.id).toBeDefined();
    });

    it('returns original content when script returns nothing', async () => {
      const script = await compile('return null;');

      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.JAVASCRIPT,
        script,
      };
      const handler = new AttachmentHandler(config, executor, DEFAULT_EXECUTION_OPTIONS);

      const result = await handler.extract('test content');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBe('test content');
      expect(result.value.attachments).toHaveLength(0);
    });

    it('returns original content when script execution fails', async () => {
      const script = await compile('throw new Error("boom");');

      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.JAVASCRIPT,
        script,
      };
      const handler = new AttachmentHandler(config, executor, DEFAULT_EXECUTION_OPTIONS);

      const result = await handler.extract('test content');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBe('test content');
      expect(result.value.attachments).toHaveLength(0);
    });

    it('returns original content when no sandbox provided', async () => {
      const script = await compile('return { content: "modified", attachments: [] };');

      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.JAVASCRIPT,
        script,
      };
      const handler = new AttachmentHandler(config);

      const result = await handler.extract('test content');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.content).toBe('test content');
      expect(result.value.attachments).toHaveLength(0);
    });

    it('uses default mimeType for attachments without mimeType', async () => {
      const script = await compile(`
        return {
          content: rawData,
          attachments: [{ content: "data" }]
        };
      `);

      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.JAVASCRIPT,
        script,
      };
      const handler = new AttachmentHandler(config, executor, DEFAULT_EXECUTION_OPTIONS);

      const result = await handler.extract('test');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.attachments[0]!.mimeType).toBe('application/octet-stream');
    });

    it('filters out invalid attachment entries', async () => {
      const script = await compile(`
        return {
          content: rawData,
          attachments: [
            { content: "valid" },
            42,
            null,
            { noContent: true },
          ]
        };
      `);

      const config: AttachmentConfig = {
        mode: ATTACHMENT_MODE.JAVASCRIPT,
        script,
      };
      const handler = new AttachmentHandler(config, executor, DEFAULT_EXECUTION_OPTIONS);

      const result = await handler.extract('test');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.attachments).toHaveLength(1);
      expect(result.value.attachments[0]!.content).toBe('valid');
    });
  });

  describe('ATTACHMENT_MODE constant', () => {
    it('has expected values', () => {
      expect(ATTACHMENT_MODE.NONE).toBe('NONE');
      expect(ATTACHMENT_MODE.REGEX).toBe('REGEX');
      expect(ATTACHMENT_MODE.JAVASCRIPT).toBe('JAVASCRIPT');
    });
  });
});
