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

/** A single filter rule in form state. */
export interface FilterRuleFormValues {
  readonly enabled: boolean;
  readonly name: string;
  readonly operator: 'AND' | 'OR';
  readonly type: 'JAVASCRIPT' | 'RULE_BUILDER';
  readonly script: string;
  readonly field: string;
  readonly condition: string;
  readonly values: readonly string[];
}

/** Filter form state (source or destination). */
export interface FilterFormValues {
  readonly rules: readonly FilterRuleFormValues[];
}

/** A single transformer step in form state. */
export interface TransformerStepFormValues {
  readonly enabled: boolean;
  readonly name: string;
  readonly type: 'JAVASCRIPT' | 'MAPPER' | 'MESSAGE_BUILDER';
  readonly script: string;
  readonly sourceField: string;
  readonly targetField: string;
  readonly defaultValue: string;
  readonly mapping: string;
}

/** Transformer form state (source or destination). */
export interface TransformerFormValues {
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly steps: readonly TransformerStepFormValues[];
  // Serialization templates/properties are not edited in the UI yet, but a channel
  // can gain them via Mirth XML import. Carry them through load→save unchanged so
  // saving from the editor does not silently strip them.
  readonly inboundTemplate: string | null;
  readonly outboundTemplate: string | null;
  readonly inboundProperties: Record<string, unknown>;
  readonly outboundProperties: Record<string, unknown>;
}

/**
 * Whether a transformer carries anything worth saving. A default HL7V2→HL7V2
 * transformer with no steps is omitted, but one with data-type properties or
 * templates (e.g. from a Mirth import) must be kept or saving would drop them.
 */
export function transformerHasContent(t: TransformerFormValues): boolean {
  return t.steps.length > 0
    || t.inboundDataType !== 'HL7V2'
    || t.outboundDataType !== 'HL7V2'
    || t.inboundTemplate !== null
    || t.outboundTemplate !== null
    || Object.keys(t.inboundProperties).length > 0
    || Object.keys(t.outboundProperties).length > 0;
}

/** Default empty filter rule. */
export function createDefaultFilterRule(): FilterRuleFormValues {
  return {
    enabled: true,
    name: '',
    operator: 'AND',
    type: 'JAVASCRIPT',
    script: '',
    field: '',
    condition: '',
    values: [],
  };
}

/** Default empty transformer step. */
export function createDefaultTransformerStep(): TransformerStepFormValues {
  return {
    enabled: true,
    name: '',
    type: 'JAVASCRIPT',
    script: '',
    sourceField: '',
    targetField: '',
    defaultValue: '',
    mapping: '',
  };
}

/** Default empty filter. */
export function createDefaultFilter(): FilterFormValues {
  return { rules: [] };
}

/** Default empty transformer. */
export function createDefaultTransformer(): TransformerFormValues {
  return {
    inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', steps: [],
    inboundTemplate: null, outboundTemplate: null,
    inboundProperties: {}, outboundProperties: {},
  };
}

/** Props for the top-level SourceTab component. */
export interface SourceTabProps {
  readonly control: Control<ChannelFormData>;
  readonly errors: FieldErrors<ChannelFormData>;
  readonly sourceConnectorType: string;
  readonly sourceConnectorProperties: Record<string, unknown>;
  readonly onPropertiesChange: (properties: Record<string, unknown>) => void;
  readonly sourceFilter: FilterFormValues;
  readonly onSourceFilterChange: (filter: FilterFormValues) => void;
  readonly sourceTransformer: TransformerFormValues;
  readonly onSourceTransformerChange: (transformer: TransformerFormValues) => void;
}
