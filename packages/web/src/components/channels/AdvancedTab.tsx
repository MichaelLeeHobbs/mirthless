// ===========================================
// Advanced Tab Types
// ===========================================
// Type exports only — the UI is now in SummaryTab (Channel Settings).

export interface MetadataColumnFormValues {
  name: string;
  dataType: string;
  mappingExpression: string | null;
}

export interface AdvancedFormValues {
  messageStorageMode: string;
  encryptData: boolean;
  removeContentOnCompletion: boolean;
  removeAttachmentsOnCompletion: boolean;
  pruningEnabled: boolean;
  pruningMaxAgeDays: number | null;
  pruningArchiveEnabled: boolean;
  scriptTimeoutSeconds: number;
  metadataColumns: readonly MetadataColumnFormValues[];
}
