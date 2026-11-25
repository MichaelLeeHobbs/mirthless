import { describe, it, expect } from 'vitest';
import { serverRestoreInputSchema, backupExportQuerySchema } from '../../index.js';

const EMPTY_BACKUP = {
  version: 1, exportedAt: '2026-11-16T12:00:00.000Z', channels: [], codeTemplateLibraries: [], codeTemplates: [],
  alerts: [], globalScripts: { deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }, users: [], settings: [],
  resources: [], channelGroups: [], tags: [], channelDependencies: [], configMap: [], globalMap: [],
  groupMemberships: [], tagAssignments: [],
};

describe('serverRestoreInputSchema', () => {
  it('restores a downloaded backup that carries its exportInfo header, dropping the header', () => {
    const exportInfo = { product: 'GalvaniGraph', server: 'h', exportedBy: 'kpatel', exportedAt: 'x', auditRecordId: 12, reason: 'Monthly' };
    const parsed = serverRestoreInputSchema.safeParse({ backup: { exportInfo, ...EMPTY_BACKUP }, collisionMode: 'SKIP' });

    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(parsed.success && 'exportInfo' in parsed.data.backup).toBe(false);
  });

  const template = {
    id: '00000000-0000-4000-8000-000000000001', libraryId: '00000000-0000-4000-8000-000000000002',
    name: 'fmt', description: null, type: 'FUNCTION', code: '', contexts: [],
  };
  const parseTemplate = (item: object): ReturnType<typeof serverRestoreInputSchema.safeParse> =>
    serverRestoreInputSchema.safeParse({ backup: { ...EMPTY_BACKUP, codeTemplates: [item] }, collisionMode: 'SKIP' });

  it('keeps the language of a code template (#419)', () => {
    const parsed = parseTemplate({ ...template, language: 'TYPESCRIPT' });
    expect(parsed.data?.backup.codeTemplates).toEqual([{ ...template, language: 'TYPESCRIPT' }]);
  });

  it('takes a code template from a backup made before they carried a language', () => {
    expect(parseTemplate(template).data?.backup.codeTemplates).toEqual([template]);
  });

  it('reads a language it does not know as JavaScript, so the rest of the backup restores', () => {
    const parsed = parseTemplate({ ...template, language: 'WASM' });
    expect(parsed.data?.backup.codeTemplates).toEqual([{ ...template, language: 'JAVASCRIPT' }]);
  });
});

describe('backupExportQuerySchema', () => {
  it('requires a reason', () => {
    expect(backupExportQuerySchema.safeParse({}).success).toBe(false);
    expect(backupExportQuerySchema.safeParse({ reason: 'Monthly backup' }).success).toBe(true);
  });
});
