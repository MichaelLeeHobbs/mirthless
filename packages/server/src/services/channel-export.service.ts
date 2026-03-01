// ===========================================
// Channel Export Service
// ===========================================
// Exports channels as structured JSON for backup/migration.

import { tryCatch, type Result } from 'stderr-lib';
import type { ChannelExport, ChannelExportEntry } from '@mirthless/core-models';
import { ChannelService, type ChannelDetail } from './channel.service.js';

// ----- Helpers -----

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
    sourceConnectorProperties: detail.sourceConnectorProperties,
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
    scripts: detail.scripts.map((s) => ({
      scriptType: s.scriptType,
      script: s.script,
    })),
    destinations: detail.destinations.map((d) => ({
      metaDataId: d.metaDataId,
      name: d.name,
      enabled: d.enabled,
      connectorType: d.connectorType,
      properties: d.properties,
      queueMode: d.queueMode,
      retryCount: d.retryCount,
      retryIntervalMs: d.retryIntervalMs,
      rotateQueue: d.rotateQueue,
      queueThreadCount: d.queueThreadCount,
      waitForPrevious: d.waitForPrevious,
    })),
    metadataColumns: detail.metadataColumns.map((m) => ({
      name: m.name,
      dataType: m.dataType,
      mappingExpression: m.mappingExpression,
    })),
    filters: detail.filters.map((f) => ({
      connectorId: f.connectorId,
      rules: f.rules.map((r) => ({
        enabled: r.enabled,
        name: r.name,
        operator: r.operator,
        type: r.type,
        script: r.script,
        field: r.field,
        condition: r.condition,
        values: r.values ? [...r.values] : null,
      })),
    })),
    transformers: detail.transformers.map((t) => ({
      connectorId: t.connectorId,
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
        sourceField: s.sourceField,
        targetField: s.targetField,
        defaultValue: s.defaultValue,
        mapping: s.mapping,
      })),
    })),
  };
}

// ----- Service -----

export class ChannelExportService {
  /** Export a single channel by ID. */
  static async exportChannel(id: string): Promise<Result<ChannelExport>> {
    return tryCatch(async () => {
      const detailResult = await ChannelService.getById(id);
      if (!detailResult.ok) throw detailResult.error;

      return {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        channels: [channelToExportEntry(detailResult.value)],
      };
    });
  }

  /** Export all channels. */
  static async exportAll(): Promise<Result<ChannelExport>> {
    return tryCatch(async () => {
      // Load all channels (up to 10000 — reasonable upper bound)
      const listResult = await ChannelService.list({ page: 1, pageSize: 10000 });
      if (!listResult.ok) throw listResult.error;

      const entries: ChannelExportEntry[] = [];
      for (const summary of listResult.value.data) {
        const detailResult = await ChannelService.getById(summary.id);
        if (detailResult.ok) {
          entries.push(channelToExportEntry(detailResult.value));
        }
      }

      return {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        channels: entries,
      };
    });
  }
}
