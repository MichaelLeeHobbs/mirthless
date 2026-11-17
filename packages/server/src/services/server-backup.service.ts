// ===========================================
// Server Backup/Restore Service
// ===========================================
// Exports full server configuration as JSON and restores from backup.
// Messages, statistics, and events are excluded (transient operational data).
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq, and } from 'drizzle-orm';
import type {
  ServerBackup,
  BackupCollisionMode,
  RestoreSectionResult,
  ServerRestoreResult,
  SettingType,
  ScriptLanguageCode,
} from '@galvanigraph/core-models';
import { createHash } from 'node:crypto';
import { AUDIT_ACTION, DEFAULT_STORED_SCRIPT_LANGUAGE } from '@galvanigraph/core-models';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { AuditService } from './audit.service.js';
import { db } from '../lib/db.js';
import { ChannelExportService } from './channel-export.service.js';
import { ChannelImportService } from './channel-import.service.js';
import { CodeTemplateService } from './code-template.service.js';
import { AlertService } from './alert.service.js';
import { GlobalScriptService } from './global-script.service.js';
import { UserService } from './user.service.js';
import { SettingsService } from './settings.service.js';
import { REDACTED } from '../lib/secret-redaction.js';
import { isServiceError } from '../lib/service-error.js';
import { ResourceService } from './resource.service.js';
import { ChannelGroupService } from './channel-group.service.js';
import { TagService } from './tag.service.js';
import { GlobalMapService } from './global-map.service.js';
import { ConfigMapService } from './config-map.service.js';
import { alertTriggerSchema, alertActionInputSchema, type AlertTriggerInput, type AlertActionInput } from '@galvanigraph/core-models';
import {
  channelDependencies,
  channelGroupMembers,
  channelTagAssignments,
  resources,
  codeTemplateLibraries,
  codeTemplates,
  channelGroups,
  channelTags,
} from '../db/schema/index.js';

// ----- Service -----

export class ServerBackupService {
  /** Export full server configuration as a backup payload. */
  /**
   * Export the server configuration. The export holds credentials and PHI, so
   * it is recorded in the audit log with its SHA-256 before it is returned,
   * and refused (AUDIT_UNAVAILABLE) when the record cannot be written (D-312).
   */
  static async exportBackup(reason: string, context?: AuditContext): Promise<Result<{ readonly backup: ServerBackup; readonly auditRecordId: number }>> {
    const result = await ServerBackupService.buildBackup();
    if (!result.ok) return result;
    // The hash of the file as the web saves it, less its exportInfo header
    // (written first, so removing it leaves the rest as hashed): the response
    // parsed and written with two-space indents (web/src/hooks/use-backup.ts).
    const sha256 = createHash('sha256').update(JSON.stringify(result.value, null, 2)).digest('hex');
    const recorded = await AuditService.recordOrRefuse({
      action: AUDIT_ACTION.SERVER_BACKUP_EXPORTED, outcome: 'SUCCESS',
      userId: context?.userId ?? null, ipAddress: context?.ipAddress ?? null,
      attributes: { channels: result.value.channels.length, sha256, reason },
    });
    if (!recorded.ok) return recorded;
    return { ok: true, value: { backup: result.value, auditRecordId: recorded.value }, error: null };
  }

  private static async buildBackup(): Promise<Result<ServerBackup>> {
    return tryCatch(async () => {
      // Gather all entity data in parallel where possible
      const [
        channelResult,
        librariesResult,
        templatesResult,
        alertsResult,
        globalScriptsResult,
        usersResult,
        settingsResult,
        resourcesResult,
        groupsResult,
        tagsResult,
        globalMapResult,
        configMapResult,
        membershipsResult,
        assignmentsResult,
      ] = await Promise.all([
        ChannelExportService.exportAll(),
        CodeTemplateService.listLibraries(),
        CodeTemplateService.listTemplates(),
        AlertService.list({ page: 1, pageSize: 10000 }),
        GlobalScriptService.getAll(),
        UserService.listUsers(),
        SettingsService.list(),
        ResourceService.list(),
        ChannelGroupService.listGroups(),
        TagService.listTags(),
        GlobalMapService.list(),
        ConfigMapService.list(),
        ChannelGroupService.listMemberships(),
        TagService.listAssignments(),
      ]);

      if (!channelResult.ok) throw channelResult.error;
      if (!librariesResult.ok) throw librariesResult.error;
      if (!templatesResult.ok) throw templatesResult.error;
      if (!alertsResult.ok) throw alertsResult.error;
      if (!globalScriptsResult.ok) throw globalScriptsResult.error;
      if (!usersResult.ok) throw usersResult.error;
      if (!settingsResult.ok) throw settingsResult.error;
      if (!resourcesResult.ok) throw resourcesResult.error;

      // Fetch full resource details (with content) for each resource
      const resourceDetails = await Promise.all(
        resourcesResult.value.map(async (r) => {
          const detail = await ResourceService.getById(r.id);
          return detail.ok ? detail.value : { ...r, content: null };
        }),
      );
      if (!groupsResult.ok) throw groupsResult.error;
      if (!tagsResult.ok) throw tagsResult.error;
      if (!globalMapResult.ok) throw globalMapResult.error;
      if (!configMapResult.ok) throw configMapResult.error;
      if (!membershipsResult.ok) throw membershipsResult.error;
      if (!assignmentsResult.ok) throw assignmentsResult.error;

      // Fetch full alert details in batch
      const alertIds = alertsResult.value.data.map((a) => a.id);
      const alertDetailsResult = await AlertService.getByIds(alertIds);
      if (!alertDetailsResult.ok) throw alertDetailsResult.error;
      const alertDetails = alertDetailsResult.value;

      // Fetch all channel dependencies
      const depRows = await db
        .select({
          channelId: channelDependencies.channelId,
          dependsOnChannelId: channelDependencies.dependsOnChannelId,
        })
        .from(channelDependencies);

      return {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        channels: channelResult.value.channels,
        codeTemplateLibraries: librariesResult.value.map((lib) => ({
          id: lib.id,
          name: lib.name,
          description: lib.description,
          channelIds: lib.channelIds ? [...lib.channelIds] : null,
        })),
        codeTemplates: templatesResult.value.map((t) => ({
          id: t.id,
          libraryId: t.libraryId,
          name: t.name,
          description: t.description,
          type: t.type,
          code: t.code,
          contexts: [...t.contexts],
        })),
        alerts: alertDetails.map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          enabled: a.enabled,
          trigger: {
            type: a.trigger.type,
            errorTypes: [...a.trigger.errorTypes],
            regex: a.trigger.regex,
            windowMinutes: a.trigger.windowMinutes,
          },
          channelIds: [...a.channelIds],
          actions: a.actions.map((act) => ({
            actionType: act.actionType,
            recipients: [...act.recipients],
            properties: act.properties,
          })),
          subjectTemplate: a.subjectTemplate,
          bodyTemplate: a.bodyTemplate,
          reAlertIntervalMs: a.reAlertIntervalMs,
          maxAlerts: a.maxAlerts,
        })),
        globalScripts: { ...globalScriptsResult.value },
        users: usersResult.value.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          description: null,
          // The roles the user holds; assignments carry the scope from #266 on.
          roles: [...u.roles],
          enabled: u.enabled,
        })),
        settings: settingsResult.value.map((s) => ({
          key: s.key,
          value: s.value,
          type: s.type,
          description: s.description,
          category: s.category,
        })),
        resources: resourceDetails.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
          content: 'content' in r ? (r.content ?? null) : null,
        })),
        channelGroups: groupsResult.value.map((g) => ({
          id: g.id,
          name: g.name,
          description: g.description,
        })),
        tags: tagsResult.value.map((t) => ({
          id: t.id,
          name: t.name,
          color: t.color,
        })),
        channelDependencies: depRows.map((d) => ({
          channelId: d.channelId,
          dependsOnChannelId: d.dependsOnChannelId,
        })),
        configMap: configMapResult.value.map((c) => ({
          category: c.category,
          name: c.name,
          value: c.value,
        })),
        globalMap: globalMapResult.value.map((g) => ({
          key: g.key,
          value: g.value,
          isJson: g.isJson,
        })),
        groupMemberships: membershipsResult.value.map((m) => ({
          channelGroupId: m.channelGroupId,
          channelId: m.channelId,
        })),
        tagAssignments: assignmentsResult.value.map((a) => ({
          tagId: a.tagId,
          channelId: a.channelId,
        })),
      };
    });
  }

  /** Restore server configuration from a backup payload. */
  static async restoreBackup(
    backup: ServerBackup,
    collisionMode: BackupCollisionMode,
    context?: AuditContext,
  ): Promise<Result<ServerRestoreResult>> {
    return tryCatch(async () => {
      const sections: RestoreSectionResult[] = [];

      // Restore in dependency order
      sections.push(await restoreSettings(backup.settings, collisionMode));
      sections.push(await restoreTags(backup.tags, collisionMode));
      sections.push(await restoreChannelGroups(backup.channelGroups, collisionMode));
      sections.push(await restoreResources(backup.resources, collisionMode));
      sections.push(await restoreCodeTemplateLibraries(backup.codeTemplateLibraries, collisionMode));
      sections.push(await restoreCodeTemplates(backup.codeTemplates, collisionMode));
      sections.push(await restoreGlobalScripts(backup.globalScripts));

      // Channels use existing import service
      const channelResult = await ChannelImportService.importChannels(
        backup.channels,
        collisionMode === 'OVERWRITE' ? 'OVERWRITE' : 'SKIP',
        context,
        'restore',
      );
      if (channelResult.ok) {
        sections.push({
          section: 'channels',
          created: channelResult.value.created,
          updated: channelResult.value.updated,
          skipped: channelResult.value.skipped,
          errors: channelResult.value.errors,
        });
      } else {
        sections.push({
          section: 'channels',
          created: 0, updated: 0, skipped: 0,
          errors: [channelResult.error.message],
        });
      }

      sections.push(await restoreAlerts(backup.alerts, collisionMode));
      sections.push(await restoreChannelDependencies(backup.channelDependencies));
      sections.push(await restoreConfigMap(backup.configMap, collisionMode));
      sections.push(await restoreGlobalMap(backup.globalMap, collisionMode));
      sections.push(await restoreGroupMemberships(backup.groupMemberships));
      sections.push(await restoreTagAssignments(backup.tagAssignments));

      const totals = sections.reduce(
        (acc, s) => ({
          totalCreated: acc.totalCreated + s.created,
          totalUpdated: acc.totalUpdated + s.updated,
          totalSkipped: acc.totalSkipped + s.skipped,
          totalErrors: acc.totalErrors + s.errors.length,
        }),
        { totalCreated: 0, totalUpdated: 0, totalSkipped: 0, totalErrors: 0 },
      );

      emitEvent({
        level: 'INFO', name: 'SERVER_RESTORED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: totals,
      });

      return { sections, ...totals };
    });
  }
}

// ----- Restore Helpers -----

async function restoreSettings(
  items: ServerBackup['settings'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const existing = await SettingsService.getByKey(item.key);
      // A backup masks secret values as REDACTED. Never write that marker back as
      // a live secret: if the setting already exists keep its current (real) value
      // untouched; if it is new, store empty so the operator must re-enter it.
      const isRedacted = item.value === REDACTED;
      if (existing.ok) {
        if (mode === 'SKIP') { skipped++; continue; }
        if (isRedacted) { skipped++; continue; }
        const res = await SettingsService.upsert({ key: item.key, value: item.value ?? '', type: item.type as SettingType, description: item.description ?? '', category: item.category ?? '' });
        if (!res.ok) throw res.error;
        updated++;
      } else {
        const res = await SettingsService.upsert({ key: item.key, value: isRedacted ? '' : (item.value ?? ''), type: item.type as SettingType, description: item.description ?? '', category: item.category ?? '' });
        if (!res.ok) throw res.error;
        created++;
      }
    } catch (err) {
      errors.push(`Settings "${item.key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'settings', created, updated, skipped, errors };
}

/** What restoring one backup item did; each value is a count in the section result. */
type RestoreOutcome = 'created' | 'updated' | 'skipped';

/**
 * Restore `items` one at a time with `restoreOne` and count the outcomes. A
 * thrown error is recorded as `<label>: <message>` and the next item still runs.
 */
async function restoreEach<T>(
  section: string,
  items: readonly T[],
  label: (item: T) => string,
  restoreOne: (item: T) => Promise<RestoreOutcome>,
): Promise<RestoreSectionResult> {
  const counts = { created: 0, updated: 0, skipped: 0 };
  const errors: string[] = [];

  for (const item of items) {
    try {
      counts[await restoreOne(item)]++;
    } catch (err) {
      errors.push(`${label(item)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section, ...counts, errors };
}

/** The queries that restore one table row from a backup. */
interface RowRestore {
  /** Select the row by its key; any row returned means it exists. */
  readonly find: () => PromiseLike<readonly unknown[]>;
  /** Insert the row with the key the backup carries. */
  readonly insert: () => PromiseLike<unknown>;
  /** Overwrite an existing row unless the mode is SKIP. Absent for a key-only row (a pair), which is always skipped. */
  readonly overwrite?: { readonly mode: BackupCollisionMode; readonly update: () => PromiseLike<unknown> };
}

/** Insert a missing row; skip or overwrite an existing one. */
async function restoreRow(row: RowRestore): Promise<RestoreOutcome> {
  const [existing] = await row.find();
  if (!existing) {
    await row.insert();
    return 'created';
  }
  if (!row.overwrite || row.overwrite.mode === 'SKIP') return 'skipped';
  await row.overwrite.update();
  return 'updated';
}

/**
 * Restore one config or global map entry through its service upsert. SKIP
 * leaves an entry the lookup finds alone; any failed lookup counts as created.
 */
async function upsertMapEntry(
  mode: BackupCollisionMode,
  lookup: () => Promise<Result<unknown>>,
  upsert: () => Promise<Result<unknown>>,
): Promise<RestoreOutcome> {
  const existing = await lookup();
  if (existing.ok && mode === 'SKIP') return 'skipped';
  const res = await upsert();
  if (!res.ok) throw res.error;
  return existing.ok ? 'updated' : 'created';
}

async function restoreTags(
  items: ServerBackup['tags'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  return restoreEach('tags', items, (item) => `Tag "${item.name}"`, (item) => restoreRow({
    find: () => db.select({ id: channelTags.id }).from(channelTags).where(eq(channelTags.id, item.id)),
    insert: () => db.insert(channelTags).values({ id: item.id, name: item.name, color: item.color }),
    overwrite: {
      mode,
      update: () => db.update(channelTags).set({ name: item.name, color: item.color }).where(eq(channelTags.id, item.id)),
    },
  }));
}

async function restoreChannelGroups(
  items: ServerBackup['channelGroups'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  return restoreEach('channelGroups', items, (item) => `Channel group "${item.name}"`, (item) => restoreRow({
    find: () => db.select({ id: channelGroups.id }).from(channelGroups).where(eq(channelGroups.id, item.id)),
    insert: () => db.insert(channelGroups).values({ id: item.id, name: item.name, description: item.description }),
    overwrite: {
      mode,
      update: () => db.update(channelGroups).set({ name: item.name, description: item.description }).where(eq(channelGroups.id, item.id)),
    },
  }));
}

async function restoreResources(
  items: ServerBackup['resources'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  return restoreEach('resources', items, (item) => `Resource "${item.name}"`, (item) => restoreRow({
    find: () => db.select({ id: resources.id }).from(resources).where(eq(resources.id, item.id)),
    insert: () => db.insert(resources).values({
      id: item.id, name: item.name, description: item.description,
      mimeType: item.mimeType, content: item.content,
      sizeBytes: item.content ? Buffer.byteLength(item.content, 'utf-8') : 0,
    }),
    overwrite: {
      mode,
      update: () => db.update(resources).set({
        name: item.name, description: item.description, mimeType: item.mimeType,
        content: item.content, sizeBytes: item.content ? Buffer.byteLength(item.content, 'utf-8') : 0,
        updatedAt: new Date(),
      }).where(eq(resources.id, item.id)),
    },
  }));
}

async function restoreCodeTemplateLibraries(
  items: ServerBackup['codeTemplateLibraries'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  return restoreEach('codeTemplateLibraries', items, (item) => `Code template library "${item.name}"`, (item) => restoreRow({
    find: () => db.select({ id: codeTemplateLibraries.id }).from(codeTemplateLibraries).where(eq(codeTemplateLibraries.id, item.id)),
    insert: () => db.insert(codeTemplateLibraries).values({
      id: item.id, name: item.name, description: item.description, channelIds: item.channelIds ?? null,
    }),
    overwrite: {
      mode,
      update: () => db.update(codeTemplateLibraries).set({
        name: item.name, description: item.description, channelIds: item.channelIds ?? null,
      }).where(eq(codeTemplateLibraries.id, item.id)),
    },
  }));
}

async function restoreCodeTemplates(
  items: ServerBackup['codeTemplates'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  return restoreEach('codeTemplates', items, (item) => `Code template "${item.name}"`, (item) => restoreRow({
    find: () => db.select({ id: codeTemplates.id }).from(codeTemplates).where(eq(codeTemplates.id, item.id)),
    insert: () => db.insert(codeTemplates).values({
      id: item.id, libraryId: item.libraryId, name: item.name,
      description: item.description, type: item.type, code: item.code, contexts: item.contexts,
    }),
    overwrite: {
      mode,
      update: () => db.update(codeTemplates).set({
        libraryId: item.libraryId, name: item.name, description: item.description,
        type: item.type, code: item.code, contexts: item.contexts,
      }).where(eq(codeTemplates.id, item.id)),
    },
  }));
}

const ALL_JAVASCRIPT = { deploy: 'JAVASCRIPT', undeploy: 'JAVASCRIPT', preprocessor: 'JAVASCRIPT', postprocessor: 'JAVASCRIPT' } as const;

const GLOBAL_SCRIPT_KEYS = ['deploy', 'undeploy', 'preprocessor', 'postprocessor'] as const;

/**
 * Restore one global script. A TypeScript script the save refuses as invalid
 * (a backup can hold one with type errors, saved before saves were
 * type-checked) is restored as JavaScript, which the engine runs the same, and
 * reported. Any other refusal (the type checker timed out, crashed or was busy)
 * says nothing about the script, so it is not restored and is reported: falling
 * back would drop the type check of a script that may have no errors (#228).
 * Returns the error to report, or null.
 */
async function restoreGlobalScript(
  key: (typeof GLOBAL_SCRIPT_KEYS)[number], script: string, language: ScriptLanguageCode,
): Promise<{ readonly restored: boolean; readonly error: string | null }> {
  const first = await GlobalScriptService.update({ [key]: script, languages: { [key]: language } });
  if (first.ok) return { restored: true, error: null };
  if (language === 'TYPESCRIPT' && isServiceError(first.error, 'INVALID_INPUT')) {
    const asJs = await GlobalScriptService.update({ [key]: script, languages: { [key]: 'JAVASCRIPT' } });
    if (asJs.ok) {
      return { restored: true, error: `The global ${key} script was restored as JavaScript because as TypeScript it was refused (type errors): ${first.error.message}. Fix it and switch it back to TypeScript.` };
    }
  }
  return { restored: false, error: `The global ${key} script was not restored: ${first.error.message}` };
}

async function restoreGlobalScripts(
  scripts: ServerBackup['globalScripts'],
): Promise<RestoreSectionResult> {
  // A backup taken before languages were stored holds JavaScript: restore it as
  // such, not in whatever language each script has now.
  const languages = scripts.languages ?? ALL_JAVASCRIPT;
  const all = await GlobalScriptService.update({ ...scripts, languages });
  if (all.ok) return { section: 'globalScripts', created: 0, updated: GLOBAL_SCRIPT_KEYS.length, skipped: 0, errors: [] };

  // One script was refused: restore them one at a time so the others are not lost with it (#183).
  let updated = 0;
  const errors: string[] = [];
  for (const key of GLOBAL_SCRIPT_KEYS) {
    const outcome = await restoreGlobalScript(key, scripts[key], languages[key] ?? DEFAULT_STORED_SCRIPT_LANGUAGE);
    if (outcome.restored) updated++;
    if (outcome.error !== null) errors.push(outcome.error);
  }
  return { section: 'globalScripts', created: 0, updated, skipped: 0, errors };
}

/**
 * Rebuild an alert trigger from a backup, validated so a malformed entry fails
 * that alert's restore instead of saving a broken trigger.
 */
function restoreAlertTrigger(t: ServerBackup['alerts'][number]['trigger']): AlertTriggerInput {
  return alertTriggerSchema.parse(t.type === 'NO_MESSAGES'
    ? { type: 'NO_MESSAGES', windowMinutes: t.windowMinutes }
    : { type: t.type, errorTypes: t.errorTypes, regex: t.regex });
}

/** Rebuild an alert action from a backup; CHANNEL actions keep their target channel. */
function restoreAlertAction(a: ServerBackup['alerts'][number]['actions'][number]): AlertActionInput {
  return alertActionInputSchema.parse(a.actionType === 'CHANNEL'
    ? { type: 'CHANNEL', channelId: a.properties?.['channelId'], recipients: a.recipients }
    : { type: a.actionType, recipients: a.recipients });
}

async function restoreAlerts(
  items: ServerBackup['alerts'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const existing = await AlertService.getById(item.id);
      const createInput = {
        name: item.name,
        description: item.description ?? '',
        enabled: item.enabled,
        trigger: restoreAlertTrigger(item.trigger),
        channelIds: item.channelIds,
        actions: item.actions.map(restoreAlertAction),
        subjectTemplate: item.subjectTemplate,
        bodyTemplate: item.bodyTemplate,
        reAlertIntervalMs: item.reAlertIntervalMs,
        maxAlerts: item.maxAlerts,
      };

      if (existing.ok) {
        if (mode === 'SKIP') { skipped++; continue; }
        const res = await AlertService.update(item.id, { ...createInput, revision: existing.value.revision });
        if (!res.ok) throw res.error;
        updated++;
      } else {
        const res = await AlertService.create(createInput);
        if (!res.ok) throw res.error;
        created++;
      }
    } catch (err) {
      errors.push(`Alert "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'alerts', created, updated, skipped, errors };
}

/** Dependencies are key-only pairs: an existing one has nothing to overwrite, so it is skipped in every mode. */
async function restoreChannelDependencies(
  items: ServerBackup['channelDependencies'],
): Promise<RestoreSectionResult> {
  return restoreEach(
    'channelDependencies', items,
    (item) => `Dependency ${item.channelId} -> ${item.dependsOnChannelId}`,
    (item) => restoreRow({
      find: () => db.select({ channelId: channelDependencies.channelId }).from(channelDependencies).where(and(
        eq(channelDependencies.channelId, item.channelId),
        eq(channelDependencies.dependsOnChannelId, item.dependsOnChannelId),
      )),
      insert: () => db.insert(channelDependencies).values({
        channelId: item.channelId,
        dependsOnChannelId: item.dependsOnChannelId,
      }),
    }),
  );
}

async function restoreConfigMap(
  items: ServerBackup['configMap'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  return restoreEach('configMap', items, (item) => `Config "${item.category}/${item.name}"`, (item) => upsertMapEntry(
    mode,
    () => ConfigMapService.getByKey(item.category, item.name),
    () => ConfigMapService.upsert(item.category, item.name, item.value ?? ''),
  ));
}

async function restoreGlobalMap(
  items: ServerBackup['globalMap'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  return restoreEach('globalMap', items, (item) => `Global map "${item.key}"`, (item) => upsertMapEntry(
    mode,
    () => GlobalMapService.getByKey(item.key),
    () => GlobalMapService.upsert(item.key, item.value ?? '', undefined, item.isJson),
  ));
}

async function restoreGroupMemberships(
  items: ServerBackup['groupMemberships'],
): Promise<RestoreSectionResult> {
  return restoreEach(
    'groupMemberships', items,
    (item) => `Membership ${item.channelGroupId}/${item.channelId}`,
    (item) => restoreRow({
      find: () => db.select({ channelGroupId: channelGroupMembers.channelGroupId }).from(channelGroupMembers).where(and(
        eq(channelGroupMembers.channelGroupId, item.channelGroupId),
        eq(channelGroupMembers.channelId, item.channelId),
      )),
      insert: () => db.insert(channelGroupMembers).values({
        channelGroupId: item.channelGroupId,
        channelId: item.channelId,
      }),
    }),
  );
}

async function restoreTagAssignments(
  items: ServerBackup['tagAssignments'],
): Promise<RestoreSectionResult> {
  return restoreEach(
    'tagAssignments', items,
    (item) => `Tag assignment ${item.tagId}/${item.channelId}`,
    (item) => restoreRow({
      find: () => db.select({ tagId: channelTagAssignments.tagId }).from(channelTagAssignments).where(and(
        eq(channelTagAssignments.tagId, item.tagId),
        eq(channelTagAssignments.channelId, item.channelId),
      )),
      insert: () => db.insert(channelTagAssignments).values({
        tagId: item.tagId,
        channelId: item.channelId,
      }),
    }),
  );
}
