// Types only; the UI is in SummaryTab.

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
