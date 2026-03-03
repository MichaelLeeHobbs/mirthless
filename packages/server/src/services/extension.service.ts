// ===========================================
// Extension Service
// ===========================================
// Static catalog of built-in connector types and data types.
// Enable/disable stored in system_settings table.

import { tryCatch, type Result } from 'stderr-lib';
import { EXTENSION_TYPE, type ExtensionType } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { SettingsService } from './settings.service.js';

// ----- Types -----

export interface ExtensionInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly type: ExtensionType;
  readonly description: string;
  readonly enabled: boolean;
  readonly capabilities: readonly string[];
}

// ----- Built-in Extensions -----

const BUILTIN_EXTENSIONS: ReadonlyArray<Omit<ExtensionInfo, 'enabled'>> = [
  // Connectors
  { id: 'tcp-mllp', name: 'TCP/MLLP', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'HL7v2 MLLP over TCP connector for sending and receiving HL7 messages', capabilities: ['source', 'destination'] },
  { id: 'http', name: 'HTTP', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'HTTP/REST connector for web service integration', capabilities: ['source', 'destination'] },
  { id: 'file', name: 'File', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'File system connector for reading and writing files', capabilities: ['source', 'destination'] },
  { id: 'database', name: 'Database', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'Database connector for SQL queries and stored procedures', capabilities: ['source', 'destination'] },
  { id: 'javascript', name: 'JavaScript', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'JavaScript connector for custom logic', capabilities: ['source', 'destination'] },
  { id: 'channel', name: 'Channel', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'Inter-channel message routing connector', capabilities: ['source', 'destination'] },
  { id: 'dicom', name: 'DICOM', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'DICOM connector for medical imaging', capabilities: ['source', 'destination'] },
  { id: 'smtp', name: 'SMTP', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'SMTP connector for sending email', capabilities: ['destination'] },
  { id: 'fhir', name: 'FHIR', version: '1.0.0', type: EXTENSION_TYPE.CONNECTOR, description: 'FHIR REST connector for modern healthcare APIs', capabilities: ['destination'] },
  // Data types
  { id: 'dt-raw', name: 'Raw', version: '1.0.0', type: EXTENSION_TYPE.DATA_TYPE, description: 'Raw text data type with no parsing', capabilities: ['inbound', 'outbound'] },
  { id: 'dt-hl7v2', name: 'HL7 v2.x', version: '1.0.0', type: EXTENSION_TYPE.DATA_TYPE, description: 'HL7 v2.x pipe-delimited message format', capabilities: ['inbound', 'outbound'] },
  { id: 'dt-hl7v3', name: 'HL7 v3', version: '1.0.0', type: EXTENSION_TYPE.DATA_TYPE, description: 'HL7 v3 CDA/XML message format', capabilities: ['inbound', 'outbound'] },
  { id: 'dt-xml', name: 'XML', version: '1.0.0', type: EXTENSION_TYPE.DATA_TYPE, description: 'XML data type with XPath support', capabilities: ['inbound', 'outbound'] },
  { id: 'dt-json', name: 'JSON', version: '1.0.0', type: EXTENSION_TYPE.DATA_TYPE, description: 'JSON data type with JSONPath support', capabilities: ['inbound', 'outbound'] },
  { id: 'dt-dicom', name: 'DICOM', version: '1.0.0', type: EXTENSION_TYPE.DATA_TYPE, description: 'DICOM medical imaging data type', capabilities: ['inbound', 'outbound'] },
  { id: 'dt-delimited', name: 'Delimited', version: '1.0.0', type: EXTENSION_TYPE.DATA_TYPE, description: 'Delimited text (CSV, TSV) data type', capabilities: ['inbound', 'outbound'] },
  { id: 'dt-fhir', name: 'FHIR', version: '1.0.0', type: EXTENSION_TYPE.DATA_TYPE, description: 'FHIR R4 resource data type', capabilities: ['inbound', 'outbound'] },
];

// ----- Helpers -----

function settingsKey(extId: string): string {
  return `extension.${extId}.enabled`;
}

async function isEnabled(extId: string): Promise<boolean> {
  const result = await SettingsService.getByKey(settingsKey(extId));
  if (!result.ok) return true; // Default to enabled
  return result.value.value !== 'false';
}

// ----- Service -----

export class ExtensionService {
  /** List all built-in extensions with their enabled status. */
  static async list(): Promise<Result<readonly ExtensionInfo[]>> {
    return tryCatch(async () => {
      // Fetch all extension settings in one query instead of N+1
      const settingsResult = await SettingsService.list({ category: 'extensions' });
      const enabledMap = new Map<string, string>();
      if (settingsResult.ok) {
        for (const s of settingsResult.value) {
          enabledMap.set(s.key, s.value ?? 'true');
        }
      }

      return BUILTIN_EXTENSIONS.map((ext) => ({
        ...ext,
        enabled: enabledMap.get(settingsKey(ext.id)) !== 'false',
      }));
    });
  }

  /** Get a single extension by ID. */
  static async getById(id: string): Promise<Result<ExtensionInfo>> {
    return tryCatch(async () => {
      const ext = BUILTIN_EXTENSIONS.find((e) => e.id === id);
      if (!ext) {
        throw new ServiceError('NOT_FOUND', `Extension "${id}" not found`);
      }
      const enabled = await isEnabled(ext.id);
      return { ...ext, enabled };
    });
  }

  /** Enable or disable an extension. */
  static async setEnabled(id: string, enabled: boolean): Promise<Result<ExtensionInfo>> {
    return tryCatch(async () => {
      const ext = BUILTIN_EXTENSIONS.find((e) => e.id === id);
      if (!ext) {
        throw new ServiceError('NOT_FOUND', `Extension "${id}" not found`);
      }

      await SettingsService.upsert({
        key: settingsKey(ext.id),
        value: String(enabled),
        type: 'boolean',
        description: `Enable/disable ${ext.name} extension`,
        category: 'extensions',
      });

      return { ...ext, enabled };
    });
  }
}
