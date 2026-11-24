import { tryCatch, type Result } from 'stderr-lib';
import { ALL_CHANNELS, toScriptLanguage, type ChannelExport, type ChannelExportEntry } from '@galvanigraph/core-models';
import { errorInfo } from '@galvanigraph/core-util';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import logger from '../lib/logger.js';
import { foundOrThrow, ServiceError } from '../lib/service-error.js';
import { redactConnectorProperties } from '../lib/secret-redaction.js';
import { ChannelService, type ChannelDetail } from './channel.service.js';
import type { ChannelScope } from '../lib/channel-scope.js';

/** A null connectorId is the source. */
function destinationMetaDataId(detail: ChannelDetail, connectorId: string | null): number | null {
  if (connectorId === null) return null;
  return detail.destinations.find((d) => d.id === connectorId)?.metaDataId ?? null;
}

function channelToExportEntry(detail: ChannelDetail): ChannelExportEntry {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    enabled: detail.enabled,
    revision: detail.revision,
    inboundDataType: detail.inboundDataType,
    outboundDataType: detail.outboundDataType,
    sourceConnectorType: detail.sourceConnectorType,
    // Secret credentials are redacted from exports so a backup file cannot leak
    // DB/SMTP/IMAP passwords. Re-import requires re-entering credentials.
    sourceConnectorProperties: redactConnectorProperties(detail.sourceConnectorProperties),
    responseMode: detail.responseMode,
    responseConnectorName: detail.responseConnectorName,
    initialState: detail.initialState,
    messageStorageMode: detail.messageStorageMode,
    encryptData: detail.encryptData,
    removeContentOnCompletion: detail.removeContentOnCompletion,
    removeAttachmentsOnCompletion: detail.removeAttachmentsOnCompletion,
    pruningEnabled: detail.pruningEnabled,
    pruningMaxAgeDays: detail.pruningMaxAgeDays,
    pruningArchiveEnabled: detail.pruningArchiveEnabled,
    scriptTimeoutSeconds: detail.scriptTimeoutSeconds,
    scripts: detail.scripts.map((s) => ({
      scriptType: s.scriptType,
      script: s.script,
      language: toScriptLanguage(s.language),
    })),
    destinations: detail.destinations.map((d) => ({
      metaDataId: d.metaDataId,
      name: d.name,
      enabled: d.enabled,
      connectorType: d.connectorType,
      properties: redactConnectorProperties(d.properties),
      queueMode: d.queueMode,
      retryCount: d.retryCount,
      retryIntervalMs: d.retryIntervalMs,
      rotateQueue: d.rotateQueue,
      queueThreadCount: d.queueThreadCount,
      waitForPrevious: d.waitForPrevious,
      responseTransformer: d.responseTransformer,
      responseTransformerLanguage: toScriptLanguage(d.responseTransformerLanguage),
    })),
    metadataColumns: detail.metadataColumns.map((m) => ({
      name: m.name,
      dataType: m.dataType,
      mappingExpression: m.mappingExpression,
    })),
    filters: detail.filters.map((f) => ({
      connectorId: f.connectorId,
      metaDataId: destinationMetaDataId(detail, f.connectorId),
      rules: f.rules.map((r) => ({
        enabled: r.enabled,
        name: r.name,
        operator: r.operator,
        type: r.type,
        script: r.script,
        language: toScriptLanguage(r.language),
        field: r.field,
        condition: r.condition,
        values: r.values ? [...r.values] : null,
      })),
    })),
    transformers: detail.transformers.map((t) => ({
      connectorId: t.connectorId,
      metaDataId: destinationMetaDataId(detail, t.connectorId),
      inboundDataType: t.inboundDataType,
      outboundDataType: t.outboundDataType,
      inboundProperties: t.inboundProperties,
      outboundProperties: t.outboundProperties,
      inboundTemplate: t.inboundTemplate,
      outboundTemplate: t.outboundTemplate,
      steps: t.steps.map((s) => ({
        enabled: s.enabled,
        name: s.name,
        type: s.type,
        script: s.script,
        language: toScriptLanguage(s.language),
        sourceField: s.sourceField,
        targetField: s.targetField,
        defaultValue: s.defaultValue,
        mapping: s.mapping,
      })),
    })),
  };
}

const MAX_CHANNELS = 10000;

/** Null: deleted after the list was read, so not missing from the export. */
async function readEntry(summary: { readonly id: string; readonly name: string }): Promise<ChannelExportEntry | null> {
  try {
    const detail = foundOrThrow(await ChannelService.getById(summary.id));
    return detail && channelToExportEntry(detail);
  } catch (err) {
    logger.error({ ...errorInfo(err), channelId: summary.id }, 'Export failed: channel could not be read');
    throw new ServiceError('INTERNAL', `Channel "${summary.name}" (${summary.id}) could not be read, so nothing was exported`);
  }
}

export class ChannelExportService {
  static async exportChannel(id: string, context?: AuditContext): Promise<Result<ChannelExport>> {
    return tryCatch(async () => {
      const detailResult = await ChannelService.getById(id);
      if (!detailResult.ok) throw detailResult.error;

      emitEvent({
        level: 'INFO', name: 'CHANNEL_EXPORTED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: id,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { scope: 'single' },
      });

      return {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        channels: [channelToExportEntry(detailResult.value)],
      };
    });
  }

  static async exportAll(context?: AuditContext, scope: ChannelScope = ALL_CHANNELS): Promise<Result<ChannelExport>> {
    return tryCatch(async () => {
      const listResult = await ChannelService.list({ page: 1, pageSize: MAX_CHANNELS }, scope);
      if (!listResult.ok) throw listResult.error;
      const { total } = listResult.value.pagination;
      if (total > MAX_CHANNELS) {
        throw new ServiceError('INTERNAL', `One export reads at most ${String(MAX_CHANNELS)} channels and there are ${String(total)}, so nothing was exported`);
      }

      const entries: ChannelExportEntry[] = [];
      for (const summary of listResult.value.data) {
        const entry = await readEntry(summary);
        if (entry) entries.push(entry);
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_EXPORTED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { scope: 'all', count: entries.length },
      });

      return {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        channels: entries,
      };
    });
  }
}
