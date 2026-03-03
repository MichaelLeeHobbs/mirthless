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
} from '@mirthless/core-models';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { ChannelExportService } from './channel-export.service.js';
import { ChannelImportService } from './channel-import.service.js';
import { CodeTemplateService } from './code-template.service.js';
import { AlertService } from './alert.service.js';
import { GlobalScriptService } from './global-script.service.js';
import { UserService } from './user.service.js';
import { SettingsService } from './settings.service.js';
import { ResourceService } from './resource.service.js';
import { ChannelGroupService } from './channel-group.service.js';
import { TagService } from './tag.service.js';
import { GlobalMapService } from './global-map.service.js';
import { ConfigMapService } from './config-map.service.js';
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
  static async exportBackup(): Promise<Result<ServerBackup>> {
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
          role: u.role,
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
      sections.push(await restoreChannelDependencies(backup.channelDependencies, collisionMode));
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
      if (existing.ok) {
        if (mode === 'SKIP') { skipped++; continue; }
        await SettingsService.upsert({ key: item.key, value: item.value ?? '', type: item.type as SettingType, description: item.description ?? '', category: item.category ?? '' });
        updated++;
      } else {
        await SettingsService.upsert({ key: item.key, value: item.value ?? '', type: item.type as SettingType, description: item.description ?? '', category: item.category ?? '' });
        created++;
      }
    } catch (err) {
      errors.push(`Settings "${item.key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'settings', created, updated, skipped, errors };
}

async function restoreTags(
  items: ServerBackup['tags'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const [existing] = await db
        .select({ id: channelTags.id })
        .from(channelTags)
        .where(eq(channelTags.id, item.id));

      if (existing) {
        if (mode === 'SKIP') { skipped++; continue; }
        await db.update(channelTags).set({ name: item.name, color: item.color }).where(eq(channelTags.id, item.id));
        updated++;
      } else {
        await db.insert(channelTags).values({ id: item.id, name: item.name, color: item.color });
        created++;
      }
    } catch (err) {
      errors.push(`Tag "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'tags', created, updated, skipped, errors };
}

async function restoreChannelGroups(
  items: ServerBackup['channelGroups'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const [existing] = await db
        .select({ id: channelGroups.id })
        .from(channelGroups)
        .where(eq(channelGroups.id, item.id));

      if (existing) {
        if (mode === 'SKIP') { skipped++; continue; }
        await db.update(channelGroups).set({ name: item.name, description: item.description }).where(eq(channelGroups.id, item.id));
        updated++;
      } else {
        await db.insert(channelGroups).values({ id: item.id, name: item.name, description: item.description });
        created++;
      }
    } catch (err) {
      errors.push(`Channel group "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'channelGroups', created, updated, skipped, errors };
}

async function restoreResources(
  items: ServerBackup['resources'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const [existing] = await db
        .select({ id: resources.id })
        .from(resources)
        .where(eq(resources.id, item.id));

      if (existing) {
        if (mode === 'SKIP') { skipped++; continue; }
        const sizeBytes = item.content ? Buffer.byteLength(item.content, 'utf-8') : 0;
        await db.update(resources).set({
          name: item.name, description: item.description, mimeType: item.mimeType,
          content: item.content, sizeBytes, updatedAt: new Date(),
        }).where(eq(resources.id, item.id));
        updated++;
      } else {
        const sizeBytes = item.content ? Buffer.byteLength(item.content, 'utf-8') : 0;
        await db.insert(resources).values({
          id: item.id, name: item.name, description: item.description,
          mimeType: item.mimeType, content: item.content, sizeBytes,
        });
        created++;
      }
    } catch (err) {
      errors.push(`Resource "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'resources', created, updated, skipped, errors };
}

async function restoreCodeTemplateLibraries(
  items: ServerBackup['codeTemplateLibraries'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const [existing] = await db
        .select({ id: codeTemplateLibraries.id })
        .from(codeTemplateLibraries)
        .where(eq(codeTemplateLibraries.id, item.id));

      if (existing) {
        if (mode === 'SKIP') { skipped++; continue; }
        await db.update(codeTemplateLibraries).set({ name: item.name, description: item.description }).where(eq(codeTemplateLibraries.id, item.id));
        updated++;
      } else {
        await db.insert(codeTemplateLibraries).values({ id: item.id, name: item.name, description: item.description });
        created++;
      }
    } catch (err) {
      errors.push(`Code template library "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'codeTemplateLibraries', created, updated, skipped, errors };
}

async function restoreCodeTemplates(
  items: ServerBackup['codeTemplates'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const [existing] = await db
        .select({ id: codeTemplates.id })
        .from(codeTemplates)
        .where(eq(codeTemplates.id, item.id));

      if (existing) {
        if (mode === 'SKIP') { skipped++; continue; }
        await db.update(codeTemplates).set({
          libraryId: item.libraryId, name: item.name, description: item.description,
          type: item.type, code: item.code, contexts: item.contexts,
        }).where(eq(codeTemplates.id, item.id));
        updated++;
      } else {
        await db.insert(codeTemplates).values({
          id: item.id, libraryId: item.libraryId, name: item.name,
          description: item.description, type: item.type, code: item.code, contexts: item.contexts,
        });
        created++;
      }
    } catch (err) {
      errors.push(`Code template "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'codeTemplates', created, updated, skipped, errors };
}

async function restoreGlobalScripts(
  scripts: ServerBackup['globalScripts'],
): Promise<RestoreSectionResult> {
  const result = await GlobalScriptService.update(scripts);
  if (!result.ok) {
    return { section: 'globalScripts', created: 0, updated: 0, skipped: 0, errors: [result.error.message] };
  }
  return { section: 'globalScripts', created: 0, updated: 1, skipped: 0, errors: [] };
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
        trigger: {
          type: item.trigger.type as 'CHANNEL_ERROR',
          errorTypes: item.trigger.errorTypes as Array<'ANY'>,
          regex: item.trigger.regex,
        },
        channelIds: item.channelIds,
        actions: item.actions.map((a) => ({
          type: a.actionType as 'EMAIL',
          recipients: a.recipients,
        })),
        subjectTemplate: item.subjectTemplate,
        bodyTemplate: item.bodyTemplate,
        reAlertIntervalMs: item.reAlertIntervalMs,
        maxAlerts: item.maxAlerts,
      };

      if (existing.ok) {
        if (mode === 'SKIP') { skipped++; continue; }
        await AlertService.update(item.id, { ...createInput, revision: existing.value.revision });
        updated++;
      } else {
        await AlertService.create(createInput);
        created++;
      }
    } catch (err) {
      errors.push(`Alert "${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'alerts', created, updated, skipped, errors };
}

async function restoreChannelDependencies(
  items: ServerBackup['channelDependencies'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const [existing] = await db
        .select({ channelId: channelDependencies.channelId })
        .from(channelDependencies)
        .where(and(
          eq(channelDependencies.channelId, item.channelId),
          eq(channelDependencies.dependsOnChannelId, item.dependsOnChannelId),
        ));

      if (existing) {
        if (mode === 'SKIP') { skipped++; continue; }
        skipped++; // Dependencies are idempotent — nothing to overwrite
      } else {
        await db.insert(channelDependencies).values({
          channelId: item.channelId,
          dependsOnChannelId: item.dependsOnChannelId,
        });
        created++;
      }
    } catch (err) {
      errors.push(`Dependency ${item.channelId} -> ${item.dependsOnChannelId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'channelDependencies', created, updated: 0, skipped, errors };
}

async function restoreConfigMap(
  items: ServerBackup['configMap'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const existing = await ConfigMapService.getByKey(item.category, item.name);
      if (existing.ok) {
        if (mode === 'SKIP') { skipped++; continue; }
        await ConfigMapService.upsert(item.category, item.name, item.value ?? '');
        updated++;
      } else {
        await ConfigMapService.upsert(item.category, item.name, item.value ?? '');
        created++;
      }
    } catch (err) {
      errors.push(`Config "${item.category}/${item.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'configMap', created, updated, skipped, errors };
}

async function restoreGlobalMap(
  items: ServerBackup['globalMap'],
  mode: BackupCollisionMode,
): Promise<RestoreSectionResult> {
  let created = 0; let updated = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const existing = await GlobalMapService.getByKey(item.key);
      if (existing.ok) {
        if (mode === 'SKIP') { skipped++; continue; }
        await GlobalMapService.upsert(item.key, item.value ?? '');
        updated++;
      } else {
        await GlobalMapService.upsert(item.key, item.value ?? '');
        created++;
      }
    } catch (err) {
      errors.push(`Global map "${item.key}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'globalMap', created, updated, skipped, errors };
}

async function restoreGroupMemberships(
  items: ServerBackup['groupMemberships'],
): Promise<RestoreSectionResult> {
  let created = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const [existing] = await db
        .select({ channelGroupId: channelGroupMembers.channelGroupId })
        .from(channelGroupMembers)
        .where(and(
          eq(channelGroupMembers.channelGroupId, item.channelGroupId),
          eq(channelGroupMembers.channelId, item.channelId),
        ));

      if (existing) {
        skipped++;
      } else {
        await db.insert(channelGroupMembers).values({
          channelGroupId: item.channelGroupId,
          channelId: item.channelId,
        });
        created++;
      }
    } catch (err) {
      errors.push(`Membership ${item.channelGroupId}/${item.channelId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'groupMemberships', created, updated: 0, skipped, errors };
}

async function restoreTagAssignments(
  items: ServerBackup['tagAssignments'],
): Promise<RestoreSectionResult> {
  let created = 0; let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    try {
      const [existing] = await db
        .select({ tagId: channelTagAssignments.tagId })
        .from(channelTagAssignments)
        .where(and(
          eq(channelTagAssignments.tagId, item.tagId),
          eq(channelTagAssignments.channelId, item.channelId),
        ));

      if (existing) {
        skipped++;
      } else {
        await db.insert(channelTagAssignments).values({
          tagId: item.tagId,
          channelId: item.channelId,
        });
        created++;
      }
    } catch (err) {
      errors.push(`Tag assignment ${item.tagId}/${item.channelId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { section: 'tagAssignments', created, updated: 0, skipped, errors };
}
