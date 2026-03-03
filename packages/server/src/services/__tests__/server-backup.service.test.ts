// ===========================================
// Server Backup Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerBackup } from '@mirthless/core-models';

// ----- Mock Dependencies -----

const mockChannelExportAll = vi.fn();
const mockChannelImportChannels = vi.fn();
const mockListLibraries = vi.fn();
const mockListTemplates = vi.fn();
const mockAlertList = vi.fn();
const mockAlertGetByIds = vi.fn();
const mockAlertCreate = vi.fn();
const mockAlertUpdate = vi.fn();
const mockAlertGetById = vi.fn();
const mockGlobalScriptGetAll = vi.fn();
const mockGlobalScriptUpdate = vi.fn();
const mockUserListUsers = vi.fn();
const mockSettingsList = vi.fn();
const mockSettingsGetByKey = vi.fn();
const mockSettingsUpsert = vi.fn();
const mockResourceList = vi.fn();
const mockResourceGetById = vi.fn();
const mockGroupListGroups = vi.fn();
const mockGroupListMemberships = vi.fn();
const mockTagListTags = vi.fn();
const mockTagListAssignments = vi.fn();
const mockGlobalMapList = vi.fn();
const mockGlobalMapGetByKey = vi.fn();
const mockGlobalMapUpsert = vi.fn();
const mockConfigMapList = vi.fn();
const mockConfigMapGetByKey = vi.fn();
const mockConfigMapUpsert = vi.fn();

const mockSelectWhere = vi.fn();
const mockSelectFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsertValues = vi.fn();
const mockInsert = vi.fn();
const mockUpdateWhere = vi.fn();
const mockSet = vi.fn();
const mockUpdate = vi.fn();

const mockDb = { select: mockSelect, insert: mockInsert, update: mockUpdate };

vi.mock('../../lib/db.js', () => ({ db: mockDb, default: mockDb }));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ type: 'eq', val })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
}));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));

vi.mock('../channel-export.service.js', () => ({
  ChannelExportService: { exportAll: mockChannelExportAll },
}));
vi.mock('../channel-import.service.js', () => ({
  ChannelImportService: { importChannels: mockChannelImportChannels },
}));
vi.mock('../code-template.service.js', () => ({
  CodeTemplateService: { listLibraries: mockListLibraries, listTemplates: mockListTemplates },
}));
vi.mock('../alert.service.js', () => ({
  AlertService: { list: mockAlertList, getById: mockAlertGetById, getByIds: mockAlertGetByIds, create: mockAlertCreate, update: mockAlertUpdate },
}));
vi.mock('../global-script.service.js', () => ({
  GlobalScriptService: { getAll: mockGlobalScriptGetAll, update: mockGlobalScriptUpdate },
}));
vi.mock('../user.service.js', () => ({
  UserService: { listUsers: mockUserListUsers },
}));
vi.mock('../settings.service.js', () => ({
  SettingsService: { list: mockSettingsList, getByKey: mockSettingsGetByKey, upsert: mockSettingsUpsert },
}));
vi.mock('../resource.service.js', () => ({
  ResourceService: { list: mockResourceList, getById: mockResourceGetById },
}));
vi.mock('../channel-group.service.js', () => ({
  ChannelGroupService: { listGroups: mockGroupListGroups, listMemberships: mockGroupListMemberships },
}));
vi.mock('../tag.service.js', () => ({
  TagService: { listTags: mockTagListTags, listAssignments: mockTagListAssignments },
}));
vi.mock('../global-map.service.js', () => ({
  GlobalMapService: { list: mockGlobalMapList, getByKey: mockGlobalMapGetByKey, upsert: mockGlobalMapUpsert },
}));
vi.mock('../config-map.service.js', () => ({
  ConfigMapService: { list: mockConfigMapList, getByKey: mockConfigMapGetByKey, upsert: mockConfigMapUpsert },
}));

const { ServerBackupService } = await import('../server-backup.service.js');

// ----- Fixtures -----

function okResult<T>(value: T): { ok: true; value: T; error: null } {
  return { ok: true, value, error: null };
}

function errResult(message: string): { ok: false; value: null; error: { message: string } } {
  return { ok: false, value: null, error: { message } };
}

function makeMinimalBackup(overrides?: Partial<ServerBackup>): ServerBackup {
  return {
    version: 1,
    exportedAt: '2026-03-02T00:00:00.000Z',
    channels: [],
    codeTemplateLibraries: [],
    codeTemplates: [],
    alerts: [],
    globalScripts: { deploy: '', undeploy: '', preprocessor: '', postprocessor: '' },
    users: [],
    settings: [],
    resources: [],
    channelGroups: [],
    tags: [],
    channelDependencies: [],
    configMap: [],
    globalMap: [],
    groupMemberships: [],
    tagAssignments: [],
    ...overrides,
  };
}

/** Reset db mock chain to consistent defaults. */
function resetDbMocks(): void {
  mockSelectWhere.mockReset().mockResolvedValue([]);
  // .from() returns a thenable (for queries without .where()) that also has .where()
  mockSelectFrom.mockReset().mockReturnValue(
    Object.assign(Promise.resolve([]), { where: mockSelectWhere }),
  );
  mockSelect.mockReset().mockReturnValue({ from: mockSelectFrom });
  mockInsertValues.mockReset().mockResolvedValue(undefined);
  mockInsert.mockReset().mockReturnValue({ values: mockInsertValues });
  mockUpdateWhere.mockReset().mockResolvedValue(undefined);
  mockSet.mockReset().mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReset().mockReturnValue({ set: mockSet });
}

/** Set up all service mocks for export with empty defaults. */
function setupExportMocks(): void {
  mockChannelExportAll.mockResolvedValue(okResult({ version: 1, exportedAt: '', channels: [] }));
  mockListLibraries.mockResolvedValue(okResult([]));
  mockListTemplates.mockResolvedValue(okResult([]));
  mockAlertList.mockResolvedValue(okResult({ data: [], pagination: { page: 1, pageSize: 10000, total: 0, totalPages: 0 } }));
  mockAlertGetByIds.mockResolvedValue(okResult([]));
  mockGlobalScriptGetAll.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));
  mockUserListUsers.mockResolvedValue(okResult([]));
  mockSettingsList.mockResolvedValue(okResult([]));
  mockResourceList.mockResolvedValue(okResult([]));
  mockGroupListGroups.mockResolvedValue(okResult([]));
  mockTagListTags.mockResolvedValue(okResult([]));
  mockGlobalMapList.mockResolvedValue(okResult([]));
  mockConfigMapList.mockResolvedValue(okResult([]));
  mockGroupListMemberships.mockResolvedValue(okResult([]));
  mockTagListAssignments.mockResolvedValue(okResult([]));
}

// ----- Setup -----

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMocks();
});

// ----- Tests -----

describe('ServerBackupService', () => {
  describe('exportBackup', () => {
    it('returns backup payload with all sections', async () => {
      setupExportMocks();

      const result = await ServerBackupService.exportBackup();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.version).toBe(1);
      expect(result.value.channels).toEqual([]);
      expect(result.value.codeTemplateLibraries).toEqual([]);
      expect(result.value.settings).toEqual([]);
    });

    it('includes channels from export service', async () => {
      setupExportMocks();
      const channelEntry = { id: 'ch-1', name: 'Test Channel' };
      mockChannelExportAll.mockResolvedValue(okResult({ version: 1, exportedAt: '', channels: [channelEntry] }));

      const result = await ServerBackupService.exportBackup();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.channels).toHaveLength(1);
    });

    it('includes user data without password hash', async () => {
      setupExportMocks();
      const user = {
        id: 'u-1', username: 'admin', email: 'a@b.com',
        firstName: 'A', lastName: 'B', role: 'admin', enabled: true,
      };
      mockUserListUsers.mockResolvedValue(okResult([user]));

      const result = await ServerBackupService.exportBackup();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.users).toHaveLength(1);
      expect(result.value.users[0]).not.toHaveProperty('passwordHash');
    });

    it('returns error when channel export fails', async () => {
      setupExportMocks();
      mockChannelExportAll.mockResolvedValue(errResult('DB error'));

      const result = await ServerBackupService.exportBackup();

      expect(result.ok).toBe(false);
    });

    it('includes alert details with trigger and actions', async () => {
      setupExportMocks();
      const alertSummary = { id: 'a-1', name: 'Test Alert' };
      const alertDetail = {
        id: 'a-1', name: 'Test Alert', description: null, enabled: true,
        revision: 1,
        trigger: { type: 'ON_ERROR', errorTypes: ['GENERAL'], regex: null },
        channelIds: ['ch-1'],
        actions: [{ actionType: 'EMAIL', recipients: ['a@b.com'], properties: null }],
        subjectTemplate: null, bodyTemplate: null, reAlertIntervalMs: null, maxAlerts: null,
      };
      mockAlertList.mockResolvedValue(okResult({ data: [alertSummary], pagination: { page: 1, pageSize: 10000, total: 1, totalPages: 1 } }));
      mockAlertGetByIds.mockResolvedValue(okResult([alertDetail]));

      const result = await ServerBackupService.exportBackup();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.alerts).toHaveLength(1);
      expect(result.value.alerts[0]!.trigger.type).toBe('ON_ERROR');
    });

    it('includes resource content from detail fetch', async () => {
      setupExportMocks();
      mockResourceList.mockResolvedValue(okResult([
        { id: 'r-1', name: 'Script', description: null, mimeType: 'text/plain', sizeBytes: 10 },
      ]));
      mockResourceGetById.mockResolvedValue(okResult({
        id: 'r-1', name: 'Script', description: null, mimeType: 'text/plain', sizeBytes: 10, content: 'console.log(1)',
      }));

      const result = await ServerBackupService.exportBackup();

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.resources).toHaveLength(1);
      expect(result.value.resources[0]!.content).toBe('console.log(1)');
    });
  });

  describe('restoreBackup', () => {
    it('restores empty backup with zero totals', async () => {
      const backup = makeMinimalBackup();
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totalCreated).toBe(0);
      expect(result.value.totalErrors).toBe(0);
    });

    it('restores settings in SKIP mode', async () => {
      const backup = makeMinimalBackup({
        settings: [{ key: 'test.key', value: 'val', type: 'string', description: null, category: 'test' }],
      });
      mockSettingsGetByKey.mockResolvedValue(okResult({ key: 'test.key', value: 'old' }));
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const settingsSection = result.value.sections.find((s) => s.section === 'settings');
      expect(settingsSection?.skipped).toBe(1);
      expect(mockSettingsUpsert).not.toHaveBeenCalled();
    });

    it('restores settings in OVERWRITE mode', async () => {
      const backup = makeMinimalBackup({
        settings: [{ key: 'test.key', value: 'val', type: 'string', description: null, category: 'test' }],
      });
      mockSettingsGetByKey.mockResolvedValue(okResult({ key: 'test.key', value: 'old' }));
      mockSettingsUpsert.mockResolvedValue(okResult({ key: 'test.key', value: 'val' }));
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'OVERWRITE');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const settingsSection = result.value.sections.find((s) => s.section === 'settings');
      expect(settingsSection?.updated).toBe(1);
    });

    it('creates new settings when they do not exist', async () => {
      const backup = makeMinimalBackup({
        settings: [{ key: 'new.key', value: 'val', type: 'string', description: null, category: 'test' }],
      });
      mockSettingsGetByKey.mockResolvedValue(errResult('NOT_FOUND'));
      mockSettingsUpsert.mockResolvedValue(okResult({ key: 'new.key', value: 'val' }));
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const settingsSection = result.value.sections.find((s) => s.section === 'settings');
      expect(settingsSection?.created).toBe(1);
    });

    it('restores tags with SKIP mode', async () => {
      const backup = makeMinimalBackup({
        tags: [{ id: 't-1', name: 'ER', color: '#FF0000' }],
      });
      mockSelectWhere.mockResolvedValue([{ id: 't-1' }]);
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tagSection = result.value.sections.find((s) => s.section === 'tags');
      expect(tagSection?.skipped).toBe(1);
    });

    it('creates new tags when they do not exist', async () => {
      const backup = makeMinimalBackup({
        tags: [{ id: 't-1', name: 'ER', color: '#FF0000' }],
      });
      mockSelectWhere.mockResolvedValue([]);
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tagSection = result.value.sections.find((s) => s.section === 'tags');
      expect(tagSection?.created).toBe(1);
    });

    it('delegates channel restore to ChannelImportService', async () => {
      const backup = makeMinimalBackup({
        channels: [{ id: 'ch-1', name: 'Test' } as never],
      });
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 1, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mockChannelImportChannels).toHaveBeenCalledWith(
        backup.channels,
        'SKIP',
        undefined,
      );
    });

    it('handles channel import failure gracefully', async () => {
      const backup = makeMinimalBackup();
      mockChannelImportChannels.mockResolvedValue(errResult('Import failed'));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const channelSection = result.value.sections.find((s) => s.section === 'channels');
      expect(channelSection?.errors).toContain('Import failed');
    });

    it('restores global scripts', async () => {
      const backup = makeMinimalBackup({
        globalScripts: { deploy: 'console.log("deploy")', undeploy: '', preprocessor: '', postprocessor: '' },
      });
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult(backup.globalScripts));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(mockGlobalScriptUpdate).toHaveBeenCalledWith(backup.globalScripts);
    });

    it('restores global map entries in OVERWRITE mode', async () => {
      const backup = makeMinimalBackup({
        globalMap: [{ key: 'counter', value: '42' }],
      });
      mockGlobalMapGetByKey.mockResolvedValue(okResult({ key: 'counter', value: '10' }));
      mockGlobalMapUpsert.mockResolvedValue(okResult({ key: 'counter', value: '42' }));
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'OVERWRITE');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const gmSection = result.value.sections.find((s) => s.section === 'globalMap');
      expect(gmSection?.updated).toBe(1);
    });

    it('restores config map entries', async () => {
      const backup = makeMinimalBackup({
        configMap: [{ category: 'app', name: 'version', value: '1.0' }],
      });
      mockConfigMapGetByKey.mockResolvedValue(errResult('NOT_FOUND'));
      mockConfigMapUpsert.mockResolvedValue(okResult({ category: 'app', name: 'version', value: '1.0' }));
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const cmSection = result.value.sections.find((s) => s.section === 'configMap');
      expect(cmSection?.created).toBe(1);
    });

    it('restores group memberships', async () => {
      const backup = makeMinimalBackup({
        groupMemberships: [{ channelGroupId: 'g-1', channelId: 'ch-1' }],
      });
      mockSelectWhere.mockResolvedValue([]);
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const mSection = result.value.sections.find((s) => s.section === 'groupMemberships');
      expect(mSection?.created).toBe(1);
    });

    it('restores tag assignments', async () => {
      const backup = makeMinimalBackup({
        tagAssignments: [{ tagId: 't-1', channelId: 'ch-1' }],
      });
      mockSelectWhere.mockResolvedValue([]);
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const taSection = result.value.sections.find((s) => s.section === 'tagAssignments');
      expect(taSection?.created).toBe(1);
    });

    it('emits SERVER_RESTORED event', async () => {
      const { emitEvent } = await import('../../lib/event-emitter.js');
      const backup = makeMinimalBackup();
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(emitEvent).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'SERVER_RESTORED', outcome: 'SUCCESS' }),
      );
    });

    it('accumulates totals across sections', async () => {
      const backup = makeMinimalBackup({
        settings: [
          { key: 'a', value: '1', type: 'string', description: null, category: null },
          { key: 'b', value: '2', type: 'string', description: null, category: null },
        ],
        globalMap: [{ key: 'x', value: 'y' }],
      });
      mockSettingsGetByKey.mockResolvedValue(errResult('NOT_FOUND'));
      mockSettingsUpsert.mockResolvedValue(okResult({}));
      mockGlobalMapGetByKey.mockResolvedValue(errResult('NOT_FOUND'));
      mockGlobalMapUpsert.mockResolvedValue(okResult({}));
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.totalCreated).toBe(3); // 2 settings + 1 global map
    });
  });
});
