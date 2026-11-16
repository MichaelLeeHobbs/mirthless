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
});

describe('backupExportQuerySchema', () => {
  it('requires a reason', () => {
    expect(backupExportQuerySchema.safeParse({}).success).toBe(false);
    expect(backupExportQuerySchema.safeParse({ reason: 'Monthly backup' }).success).toBe(true);
  });
});
