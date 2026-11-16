// ===========================================
// Server Backup Service Tests
// ===========================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ServerBackup, RestoreSectionResult } from '@galvaniflow/core-models';

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
const {
  channelDependencies, channelGroupMembers, channelTagAssignments, resources,
  codeTemplateLibraries, codeTemplates, channelGroups, channelTags,
} = await import('../../db/schema/index.js');

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

    it('returns error when channel export fails, without logging an export', async () => {
      setupExportMocks();
      mockChannelExportAll.mockResolvedValue(errResult('DB error'));
      const { emitEvent } = await import('../../lib/event-emitter.js');

      const result = await ServerBackupService.exportBackup({ userId: 'u-1', ipAddress: '10.0.0.9' });

      expect(result.ok).toBe(false);
      expect(emitEvent).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'SERVER_BACKUP_EXPORTED' }));
    });

    it('audit-logs a successful export with who and from where', async () => {
      setupExportMocks();
      const { emitEvent } = await import('../../lib/event-emitter.js');

      const result = await ServerBackupService.exportBackup({ userId: 'u-1', ipAddress: '10.0.0.9' });

      expect(result.ok).toBe(true);
      expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
        name: 'SERVER_BACKUP_EXPORTED', outcome: 'SUCCESS', userId: 'u-1', ipAddress: '10.0.0.9',
      }));
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

    describe('alerts', () => {
      const CH = '11111111-1111-4111-8111-111111111111';
      const alertItem = (trigger: ServerBackup['alerts'][number]['trigger'], actions: ServerBackup['alerts'][number]['actions'] = []): ServerBackup['alerts'][number] => ({
        id: '22222222-2222-4222-8222-222222222222', name: 'A', description: null, enabled: true,
        trigger, channelIds: [], actions,
        subjectTemplate: null, bodyTemplate: null, reAlertIntervalMs: null, maxAlerts: null,
      });

      async function restoreAlert(item: ServerBackup['alerts'][number]): Promise<RestoreSectionResult | undefined> {
        mockAlertGetById.mockResolvedValue(errResult('NOT_FOUND'));
        mockAlertCreate.mockResolvedValue(okResult({ id: item.id }));
        mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
        mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));
        const result = await ServerBackupService.restoreBackup(makeMinimalBackup({ alerts: [item] }), 'SKIP');
        if (!result.ok) throw new Error('restore failed');
        return result.value.sections.find((sec) => sec.section === 'alerts');
      }

      it('restores a NO_MESSAGES trigger with its window', async () => {
        await restoreAlert(alertItem({ type: 'NO_MESSAGES', errorTypes: [], regex: null, windowMinutes: 45 }));
        expect(mockAlertCreate).toHaveBeenCalledWith(
          expect.objectContaining({ trigger: { type: 'NO_MESSAGES', windowMinutes: 45 } }),
        );
      });

      it('restores a CHANNEL_ERROR trigger from a backup made before windowMinutes existed', async () => {
        await restoreAlert(alertItem({ type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'x' }));
        expect(mockAlertCreate).toHaveBeenCalledWith(
          expect.objectContaining({ trigger: { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: 'x' } }),
        );
      });

      it('keeps the target channel of a CHANNEL action', async () => {
        await restoreAlert(alertItem(
          { type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null },
          [{ actionType: 'CHANNEL', recipients: [], properties: { channelId: CH } }],
        ));
        expect(mockAlertCreate).toHaveBeenCalledWith(
          expect.objectContaining({ actions: [{ type: 'CHANNEL', channelId: CH, recipients: [] }] }),
        );
      });

      it('reports a failed create as an error, not as created', async () => {
        mockAlertGetById.mockResolvedValue(errResult('NOT_FOUND'));
        mockAlertCreate.mockResolvedValue({ ok: false, value: null, error: new Error('name taken') });
        mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
        mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));
        const result = await ServerBackupService.restoreBackup(
          makeMinimalBackup({ alerts: [alertItem({ type: 'CHANNEL_ERROR', errorTypes: ['ANY'], regex: null })] }), 'SKIP',
        );
        if (!result.ok) throw new Error('restore failed');
        const section = result.value.sections.find((sec) => sec.section === 'alerts');
        expect(section?.created).toBe(0);
        expect(section?.errors[0]).toContain('name taken');
      });

      it('reports an invalid trigger as an error instead of saving it', async () => {
        const section = await restoreAlert(alertItem({ type: 'NO_MESSAGES', errorTypes: [], regex: null, windowMinutes: null }));
        expect(mockAlertCreate).not.toHaveBeenCalled();
        expect(section?.errors).toHaveLength(1);
      });
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
      // A backup from before languages were stored holds JavaScript, so it restores
      // as JavaScript rather than keeping whatever language each script has now.
      const js = { deploy: 'JAVASCRIPT', undeploy: 'JAVASCRIPT', preprocessor: 'JAVASCRIPT', postprocessor: 'JAVASCRIPT' };
      expect(mockGlobalScriptUpdate).toHaveBeenCalledWith({ ...backup.globalScripts, languages: js });
    });

    it('restores global scripts in the languages the backup recorded', async () => {
      const languages = { deploy: 'TYPESCRIPT', undeploy: 'JAVASCRIPT', preprocessor: 'JAVASCRIPT', postprocessor: 'JAVASCRIPT' } as const;
      const backup = makeMinimalBackup({ globalScripts: { deploy: "logger.info('up');", undeploy: '', preprocessor: '', postprocessor: '', languages } });
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult(backup.globalScripts));

      await ServerBackupService.restoreBackup(backup, 'SKIP');
      expect(mockGlobalScriptUpdate).toHaveBeenCalledWith(backup.globalScripts);
    });

    // #183: a backup can hold a TypeScript global script with type errors, saved
    // before saves were type-checked. That one script restores as JavaScript (the
    // engine runs it the same) and the section reports it; the others restore.
    it('restores a TypeScript global script with type errors as JavaScript and keeps the rest', async () => {
      const languages = { deploy: 'TYPESCRIPT', undeploy: 'JAVASCRIPT', preprocessor: 'JAVASCRIPT', postprocessor: 'JAVASCRIPT' } as const;
      const backup = makeMinimalBackup({ globalScripts: { deploy: 'const n: number = "x";', undeploy: 'logger.info(1);', preprocessor: '', postprocessor: '', languages } });
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockImplementation(async (input: { languages?: Record<string, string> }) =>
        (input.languages?.['deploy'] === 'TYPESCRIPT' ? errResult('type errors') : okResult(backup.globalScripts)));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const section = result.value.sections.find((s) => s.section === 'globalScripts');
      expect(section?.updated).toBe(4);
      expect(section?.errors).toEqual([expect.stringMatching(/^The global deploy script was restored as JavaScript.*type errors/)]);
      expect(mockGlobalScriptUpdate).toHaveBeenCalledWith({ deploy: 'const n: number = "x";', languages: { deploy: 'JAVASCRIPT' } });
      expect(mockGlobalScriptUpdate).toHaveBeenCalledWith({ undeploy: 'logger.info(1);', languages: { undeploy: 'JAVASCRIPT' } });
    });

    it('reports a global script that fails in either language and restores the rest', async () => {
      const backup = makeMinimalBackup({ globalScripts: { deploy: 'not js (', undeploy: 'logger.info(1);', preprocessor: '', postprocessor: '' } });
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockImplementation(async (input: { deploy?: string }) =>
        (input.deploy === 'not js (' ? errResult('does not compile') : okResult(backup.globalScripts)));

      const result = await ServerBackupService.restoreBackup(backup, 'SKIP');

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const section = result.value.sections.find((s) => s.section === 'globalScripts');
      expect(section?.updated).toBe(3);
      expect(section?.errors).toEqual(['The global deploy script was not restored: does not compile']);
    });

    it('restores global map entries in OVERWRITE mode', async () => {
      const backup = makeMinimalBackup({
        globalMap: [{ key: 'counter', value: '42', isJson: false }],
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

    it('restores a global map entry with the type a script stored it as', async () => {
      const backup = makeMinimalBackup({
        globalMap: [{ key: 'counter', value: '42', isJson: true }, { key: 'zip', value: '00501', isJson: false }],
      });
      mockGlobalMapGetByKey.mockResolvedValue({ ok: false, value: null, error: new Error('not found') });
      mockGlobalMapUpsert.mockResolvedValue(okResult({ key: 'counter', value: '42' }));
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));

      const result = await ServerBackupService.restoreBackup(backup, 'OVERWRITE');

      expect(result.ok).toBe(true);
      expect(mockGlobalMapUpsert).toHaveBeenCalledWith('counter', '42', undefined, true);
      expect(mockGlobalMapUpsert).toHaveBeenCalledWith('zip', '00501', undefined, false);
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
        globalMap: [{ key: 'x', value: 'y', isJson: false }],
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

  // Every section the shared restore helpers serve, pinned row by row: counts,
  // error text, and the exact values written for each collision mode.
  describe('restore sections', () => {
    async function restoreSection(
      overrides: Partial<ServerBackup>,
      mode: 'SKIP' | 'OVERWRITE',
      section: string,
    ): Promise<RestoreSectionResult> {
      mockChannelImportChannels.mockResolvedValue(okResult({ created: 0, updated: 0, skipped: 0, errors: [] }));
      mockGlobalScriptUpdate.mockResolvedValue(okResult({ deploy: '', undeploy: '', preprocessor: '', postprocessor: '' }));
      const result = await ServerBackupService.restoreBackup(makeMinimalBackup(overrides), mode);
      if (!result.ok) throw new Error('restore failed');
      const found = result.value.sections.find((s) => s.section === section);
      if (!found) throw new Error(`section ${section} missing`);
      return found;
    }

    const counts = (created: number, updated: number, skipped: number, errors: string[] = []): Omit<RestoreSectionResult, 'section'> =>
      ({ created, updated, skipped, errors });

    describe('id-keyed sections', () => {
      const resourceItem = { id: 'r-1', name: 'Lookup', description: null, mimeType: 'text/plain', content: 'héllo' };
      const libraryItem = { id: 'l-1', name: 'Lib', description: 'd', channelIds: ['ch-1'] };
      const templateItem = {
        id: 'ct-1', libraryId: 'l-1', name: 'fmt', description: null,
        type: 'FUNCTION', code: 'function f() {}', contexts: ['SOURCE_FILTER_TRANSFORMER'],
      } as ServerBackup['codeTemplates'][number];

      const cases = [
        {
          section: 'tags', table: channelTags, label: 'Tag "ER"',
          backup: { tags: [{ id: 't-1', name: 'ER', color: '#FF0000' }] },
          inserted: { id: 't-1', name: 'ER', color: '#FF0000' },
          updatedTo: { name: 'ER', color: '#FF0000' },
        },
        {
          section: 'channelGroups', table: channelGroups, label: 'Channel group "Lab"',
          backup: { channelGroups: [{ id: 'g-1', name: 'Lab', description: null }] },
          inserted: { id: 'g-1', name: 'Lab', description: null },
          updatedTo: { name: 'Lab', description: null },
        },
        {
          section: 'resources', table: resources, label: 'Resource "Lookup"',
          backup: { resources: [resourceItem] },
          inserted: { ...resourceItem, sizeBytes: 6 },
          updatedTo: { name: 'Lookup', description: null, mimeType: 'text/plain', content: 'héllo', sizeBytes: 6, updatedAt: expect.any(Date) },
        },
        {
          section: 'codeTemplateLibraries', table: codeTemplateLibraries, label: 'Code template library "Lib"',
          backup: { codeTemplateLibraries: [libraryItem] },
          inserted: libraryItem,
          updatedTo: { name: 'Lib', description: 'd', channelIds: ['ch-1'] },
        },
        {
          section: 'codeTemplates', table: codeTemplates, label: 'Code template "fmt"',
          backup: { codeTemplates: [templateItem] },
          inserted: templateItem,
          updatedTo: {
            libraryId: 'l-1', name: 'fmt', description: null,
            type: 'FUNCTION', code: 'function f() {}', contexts: ['SOURCE_FILTER_TRANSFORMER'],
          },
        },
      ] as const;

      describe.each(cases)('$section', ({ section, table, label, backup, inserted, updatedTo }) => {
        const id = inserted.id;

        it.each(['SKIP', 'OVERWRITE'] as const)('creates a missing row with the backup id in %s mode', async (mode) => {
          mockSelectWhere.mockResolvedValue([]);
          expect(await restoreSection(backup, mode, section)).toEqual({ section, ...counts(1, 0, 0) });
          expect(mockSelectWhere).toHaveBeenCalledWith({ type: 'eq', val: id });
          expect(mockInsert).toHaveBeenCalledWith(table);
          expect(mockInsertValues).toHaveBeenCalledWith(inserted);
          expect(mockUpdate).not.toHaveBeenCalled();
        });

        it('skips an existing row in SKIP mode without writing', async () => {
          mockSelectWhere.mockResolvedValue([{ id }]);
          expect(await restoreSection(backup, 'SKIP', section)).toEqual({ section, ...counts(0, 0, 1) });
          expect(mockInsert).not.toHaveBeenCalled();
          expect(mockUpdate).not.toHaveBeenCalled();
        });

        it('updates an existing row by id in OVERWRITE mode', async () => {
          mockSelectWhere.mockResolvedValue([{ id }]);
          expect(await restoreSection(backup, 'OVERWRITE', section)).toEqual({ section, ...counts(0, 1, 0) });
          expect(mockUpdate).toHaveBeenCalledWith(table);
          expect(mockSet).toHaveBeenCalledWith(updatedTo);
          expect(mockUpdateWhere).toHaveBeenCalledWith({ type: 'eq', val: id });
          expect(mockInsert).not.toHaveBeenCalled();
        });

        it('reports a failed write as an error naming the row, not as created', async () => {
          mockSelectWhere.mockResolvedValue([]);
          mockInsertValues.mockRejectedValue(new Error('duplicate key'));
          expect(await restoreSection(backup, 'SKIP', section)).toEqual({ section, ...counts(0, 0, 0, [`${label}: duplicate key`]) });
        });
      });

      it('stores a missing library channel list as null', async () => {
        mockSelectWhere.mockResolvedValue([]);
        const lib = { id: 'l-2', name: 'Lib2', description: null } as ServerBackup['codeTemplateLibraries'][number];
        await restoreSection({ codeTemplateLibraries: [lib] }, 'SKIP', 'codeTemplateLibraries');
        expect(mockInsertValues).toHaveBeenCalledWith({ id: 'l-2', name: 'Lib2', description: null, channelIds: null });
      });

      it('records zero bytes for a resource with no content', async () => {
        mockSelectWhere.mockResolvedValue([{ id: 'r-1' }]);
        await restoreSection({ resources: [{ ...resourceItem, content: null }] }, 'OVERWRITE', 'resources');
        expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ content: null, sizeBytes: 0 }));
      });

      it('keeps restoring later rows after one fails and counts each', async () => {
        mockSelectWhere.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 't-2' }]).mockResolvedValueOnce([]);
        mockInsertValues.mockRejectedValueOnce('boom').mockResolvedValue(undefined);
        const tags = [
          { id: 't-1', name: 'A', color: '#000000' },
          { id: 't-2', name: 'B', color: '#000000' },
          { id: 't-3', name: 'C', color: '#000000' },
        ];
        expect(await restoreSection({ tags }, 'OVERWRITE', 'tags')).toEqual({ section: 'tags', ...counts(1, 1, 0, ['Tag "A": boom']) });
      });
    });

    describe('composite-key pair sections', () => {
      const cases = [
        {
          section: 'channelDependencies', table: channelDependencies, label: 'Dependency ch-1 -> ch-2',
          backup: { channelDependencies: [{ channelId: 'ch-1', dependsOnChannelId: 'ch-2' }] },
          row: { channelId: 'ch-1', dependsOnChannelId: 'ch-2' },
        },
        {
          section: 'groupMemberships', table: channelGroupMembers, label: 'Membership g-1/ch-1',
          backup: { groupMemberships: [{ channelGroupId: 'g-1', channelId: 'ch-1' }] },
          row: { channelGroupId: 'g-1', channelId: 'ch-1' },
        },
        {
          section: 'tagAssignments', table: channelTagAssignments, label: 'Tag assignment t-1/ch-1',
          backup: { tagAssignments: [{ tagId: 't-1', channelId: 'ch-1' }] },
          row: { tagId: 't-1', channelId: 'ch-1' },
        },
      ] as const;

      describe.each(cases)('$section', ({ section, table, label, backup, row }) => {
        it.each(['SKIP', 'OVERWRITE'] as const)('inserts a missing pair in %s mode', async (mode) => {
          mockSelectWhere.mockResolvedValue([]);
          expect(await restoreSection(backup, mode, section)).toEqual({ section, ...counts(1, 0, 0) });
          expect(mockSelectWhere).toHaveBeenCalledWith({
            type: 'and', args: Object.values(row).map((val) => ({ type: 'eq', val })),
          });
          expect(mockInsert).toHaveBeenCalledWith(table);
          expect(mockInsertValues).toHaveBeenCalledWith(row);
        });

        it.each(['SKIP', 'OVERWRITE'] as const)('skips an existing pair in %s mode without writing', async (mode) => {
          mockSelectWhere.mockResolvedValue([row]);
          expect(await restoreSection(backup, mode, section)).toEqual({ section, ...counts(0, 0, 1) });
          expect(mockInsert).not.toHaveBeenCalled();
          expect(mockUpdate).not.toHaveBeenCalled();
        });

        it('reports a failed insert as an error naming the pair', async () => {
          mockSelectWhere.mockResolvedValue([]);
          mockInsertValues.mockRejectedValue(new Error('fk violation'));
          expect(await restoreSection(backup, 'SKIP', section)).toEqual({ section, ...counts(0, 0, 0, [`${label}: fk violation`]) });
        });
      });
    });

    describe('map sections', () => {
      const cases = [
        {
          section: 'configMap', getByKey: mockConfigMapGetByKey, upsert: mockConfigMapUpsert, label: 'Config "app/version"',
          backup: { configMap: [{ category: 'app', name: 'version', value: '1.0' }] },
          nullBackup: { configMap: [{ category: 'app', name: 'version', value: null }] },
          lookupArgs: ['app', 'version'], upsertArgs: ['app', 'version', '1.0'], nullUpsertArgs: ['app', 'version', ''],
        },
        {
          section: 'globalMap', getByKey: mockGlobalMapGetByKey, upsert: mockGlobalMapUpsert, label: 'Global map "counter"',
          backup: { globalMap: [{ key: 'counter', value: '42', isJson: true }] },
          nullBackup: { globalMap: [{ key: 'counter', value: null, isJson: false }] },
          lookupArgs: ['counter'], upsertArgs: ['counter', '42', undefined, true], nullUpsertArgs: ['counter', '', undefined, false],
        },
      ] as const;

      describe.each(cases)('$section', (c) => {
        it.each(['SKIP', 'OVERWRITE'] as const)('creates an entry the lookup does not find in %s mode', async (mode) => {
          c.getByKey.mockResolvedValue(errResult('NOT_FOUND'));
          c.upsert.mockResolvedValue(okResult({}));
          expect(await restoreSection(c.backup, mode, c.section)).toEqual({ section: c.section, ...counts(1, 0, 0) });
          expect(c.getByKey).toHaveBeenCalledWith(...c.lookupArgs);
          expect(c.upsert).toHaveBeenCalledWith(...c.upsertArgs);
        });

        it('skips an existing entry in SKIP mode without writing', async () => {
          c.getByKey.mockResolvedValue(okResult({}));
          expect(await restoreSection(c.backup, 'SKIP', c.section)).toEqual({ section: c.section, ...counts(0, 0, 1) });
          expect(c.upsert).not.toHaveBeenCalled();
        });

        it('updates an existing entry in OVERWRITE mode', async () => {
          c.getByKey.mockResolvedValue(okResult({}));
          c.upsert.mockResolvedValue(okResult({}));
          expect(await restoreSection(c.backup, 'OVERWRITE', c.section)).toEqual({ section: c.section, ...counts(0, 1, 0) });
          expect(c.upsert).toHaveBeenCalledWith(...c.upsertArgs);
        });

        it('writes a null value as an empty string', async () => {
          c.getByKey.mockResolvedValue(okResult({}));
          c.upsert.mockResolvedValue(okResult({}));
          await restoreSection(c.nullBackup, 'OVERWRITE', c.section);
          expect(c.upsert).toHaveBeenCalledWith(...c.nullUpsertArgs);
        });

        it('counts an entry as created when the lookup fails for any reason', async () => {
          c.getByKey.mockResolvedValue(errResult('connection reset'));
          c.upsert.mockResolvedValue(okResult({}));
          expect(await restoreSection(c.backup, 'OVERWRITE', c.section)).toEqual({ section: c.section, ...counts(1, 0, 0) });
        });

        it.each([
          ['existing', okResult({}), 'OVERWRITE'],
          ['missing', errResult('NOT_FOUND'), 'SKIP'],
        ] as const)('reports a failed upsert of a %s entry as an error, not a count', async (_kind, lookup, mode) => {
          c.getByKey.mockResolvedValue(lookup);
          c.upsert.mockResolvedValue({ ok: false, value: null, error: new Error('write failed') });
          expect(await restoreSection(c.backup, mode, c.section)).toEqual({ section: c.section, ...counts(0, 0, 0, [`${c.label}: write failed`]) });
        });

        it('reports a lookup that throws as an error', async () => {
          c.getByKey.mockRejectedValue(new Error('pool closed'));
          expect(await restoreSection(c.backup, 'SKIP', c.section)).toEqual({ section: c.section, ...counts(0, 0, 0, [`${c.label}: pool closed`]) });
          expect(c.upsert).not.toHaveBeenCalled();
        });
      });
    });
  });
});
