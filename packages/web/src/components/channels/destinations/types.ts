// ===========================================
// Destination Connector Form Types
// ===========================================

/** A single destination in the form state. */
export interface DestinationFormValues {
  name: string;
  enabled: boolean;
  connectorType: string;
  properties: Record<string, unknown>;
  queueMode: string;
  retryCount: number;
  retryIntervalMs: number;
  rotateQueue: boolean;
  queueThreadCount: number;
  waitForPrevious: boolean;
}

/** Props for destination connector-specific settings forms. */
export interface DestConnectorFormProps {
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}
