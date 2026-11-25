import type { ScriptLanguageCode } from '@galvanigraph/core-models';
import type { FilterFormValues, TransformerFormValues } from '../source/types.js';

export interface DestinationFormValues {
  /** What the channel's filters and transformers name it by; the server's id, or one of the form's own for a new one. */
  id: string;
  /** Null until it is saved. */
  metaDataId: number | null;
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
  /** Runs against the destination's response after a successful send (CONTENT_TYPE.RESPONSE_TRANSFORMED); empty for none. */
  responseTransformer: string;
  responseTransformerLanguage: ScriptLanguageCode;
}

export interface DestConnectorFormProps {
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}
