// ===========================================
// Source Connector Form Types
// ===========================================
// Shared interfaces for connector-specific settings forms.

import type { Control, FieldErrors } from 'react-hook-form';
import type { ChannelFormData } from '../../../pages/ChannelEditorPage.js';

/** Props for connector-specific settings forms (TCP/MLLP, HTTP, etc.) */
export interface SourceConnectorFormProps {
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}

/** Props for the top-level SourceTab component. */
export interface SourceTabProps {
  readonly control: Control<ChannelFormData>;
  readonly errors: FieldErrors<ChannelFormData>;
  readonly sourceConnectorType: string;
  readonly sourceConnectorProperties: Record<string, unknown>;
  readonly onPropertiesChange: (properties: Record<string, unknown>) => void;
}
