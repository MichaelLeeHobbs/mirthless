// ===========================================
// Destination Connector Form Types
// ===========================================

import type { FilterFormValues, TransformerFormValues } from '../source/types.js';

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
  filter: FilterFormValues;
  transformer: TransformerFormValues;
  /**
   * Per-destination response transformer script (CT_RESPONSE_TRANSFORMED). A
   * single JavaScript/TypeScript body run against the destination's response
   * after a successful send. Empty string = no response transformer.
   */
  responseTransformer: string;
}

/** Props for destination connector-specific settings forms. */
export interface DestConnectorFormProps {
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}
