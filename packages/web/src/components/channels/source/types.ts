import type { Control, FieldErrors } from 'react-hook-form';
import type { ScriptLanguageCode } from '@galvanigraph/core-models';
import { NEW_SCRIPT_LANGUAGE } from '../../../lib/script-language.js';
import type { ChannelFormData } from '../../../pages/ChannelEditorPage.js';

export interface SourceConnectorFormProps {
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}

export interface FilterRuleFormValues {
  readonly enabled: boolean;
  readonly name: string;
  readonly operator: 'AND' | 'OR';
  readonly type: 'JAVASCRIPT' | 'RULE_BUILDER';
  readonly script: string;
  readonly language: ScriptLanguageCode;
  readonly field: string;
  readonly condition: string;
  readonly values: readonly string[];
}

export interface FilterFormValues {
  readonly rules: readonly FilterRuleFormValues[];
}

export interface TransformerStepFormValues {
  readonly enabled: boolean;
  readonly name: string;
  readonly type: 'JAVASCRIPT' | 'MAPPER' | 'MESSAGE_BUILDER';
  readonly script: string;
  readonly language: ScriptLanguageCode;
  readonly sourceField: string;
  readonly targetField: string;
  readonly defaultValue: string;
  readonly mapping: string;
}

export interface TransformerFormValues {
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly steps: readonly TransformerStepFormValues[];
  // Not edited in the UI, but a Mirth import can set them: carried through load→save so saving does not strip them.
  readonly inboundTemplate: string | null;
  readonly outboundTemplate: string | null;
  readonly inboundProperties: Record<string, unknown>;
  readonly outboundProperties: Record<string, unknown>;
}

/** A default HL7V2→HL7V2 transformer with no steps is omitted; one with data-type properties or templates (e.g. from a Mirth import) must be kept or saving drops them. */
export function transformerHasContent(t: TransformerFormValues): boolean {
  return t.steps.length > 0
    || t.inboundDataType !== 'HL7V2'
    || t.outboundDataType !== 'HL7V2'
    || t.inboundTemplate !== null
    || t.outboundTemplate !== null
    || Object.keys(t.inboundProperties).length > 0
    || Object.keys(t.outboundProperties).length > 0;
}

export function createDefaultFilterRule(): FilterRuleFormValues {
  return {
    enabled: true,
    name: '',
    operator: 'AND',
    type: 'JAVASCRIPT',
    script: '',
    language: NEW_SCRIPT_LANGUAGE,
    field: '',
    condition: '',
    values: [],
  };
}

export function createDefaultTransformerStep(): TransformerStepFormValues {
  return {
    enabled: true,
    name: '',
    type: 'JAVASCRIPT',
    script: '',
    language: NEW_SCRIPT_LANGUAGE,
    sourceField: '',
    targetField: '',
    defaultValue: '',
    mapping: '',
  };
}

export function createDefaultFilter(): FilterFormValues {
  return { rules: [] };
}

export function createDefaultTransformer(): TransformerFormValues {
  return {
    inboundDataType: 'HL7V2', outboundDataType: 'HL7V2', steps: [],
    inboundTemplate: null, outboundTemplate: null,
    inboundProperties: {}, outboundProperties: {},
  };
}

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
