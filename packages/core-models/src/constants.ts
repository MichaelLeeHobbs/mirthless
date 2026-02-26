// ===========================================
// Domain Constants
// ===========================================
// Const objects used instead of enums per coding standards.
// Based on design doc 01-core-models.md.

// --- Channel ---

export const CHANNEL_STATE = {
  UNDEPLOYED: 'UNDEPLOYED',
  STARTED: 'STARTED',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
} as const;
export type ChannelState = (typeof CHANNEL_STATE)[keyof typeof CHANNEL_STATE];

export const MESSAGE_STORAGE_MODE = {
  DEVELOPMENT: 'DEVELOPMENT',
  PRODUCTION: 'PRODUCTION',
  RAW: 'RAW',
  METADATA: 'METADATA',
  DISABLED: 'DISABLED',
} as const;
export type MessageStorageMode = (typeof MESSAGE_STORAGE_MODE)[keyof typeof MESSAGE_STORAGE_MODE];

// --- Connector ---

export const CONNECTOR_MODE = {
  SOURCE: 'SOURCE',
  DESTINATION: 'DESTINATION',
} as const;
export type ConnectorMode = (typeof CONNECTOR_MODE)[keyof typeof CONNECTOR_MODE];

export const CONNECTOR_TYPE = {
  TCP_MLLP: 'TCP_MLLP',
  HTTP: 'HTTP',
  FILE: 'FILE',
  DATABASE: 'DATABASE',
  JAVASCRIPT: 'JAVASCRIPT',
  CHANNEL: 'CHANNEL',
  DICOM: 'DICOM',
  SMTP: 'SMTP',
  FHIR: 'FHIR',
} as const;
export type ConnectorType = (typeof CONNECTOR_TYPE)[keyof typeof CONNECTOR_TYPE];

export const RESPONSE_MODE = {
  NONE: 'NONE',
  AUTO_BEFORE: 'AUTO_BEFORE',
  AUTO_AFTER_TRANSFORMER: 'AUTO_AFTER_TRANSFORMER',
  AUTO_AFTER_DESTINATIONS: 'AUTO_AFTER_DESTINATIONS',
  POSTPROCESSOR: 'POSTPROCESSOR',
  DESTINATION: 'DESTINATION',
} as const;
export type ResponseMode = (typeof RESPONSE_MODE)[keyof typeof RESPONSE_MODE];

export const QUEUE_MODE = {
  NEVER: 'NEVER',
  ON_FAILURE: 'ON_FAILURE',
  ALWAYS: 'ALWAYS',
} as const;
export type QueueMode = (typeof QUEUE_MODE)[keyof typeof QUEUE_MODE];

// --- Data Types ---

export const DATA_TYPE = {
  RAW: 'RAW',
  HL7V2: 'HL7V2',
  HL7V3: 'HL7V3',
  XML: 'XML',
  JSON: 'JSON',
  DICOM: 'DICOM',
  DELIMITED: 'DELIMITED',
  FHIR: 'FHIR',
} as const;
export type DataType = (typeof DATA_TYPE)[keyof typeof DATA_TYPE];

// --- Message ---

export const MESSAGE_STATUS = {
  RECEIVED: 'RECEIVED',
  FILTERED: 'FILTERED',
  TRANSFORMED: 'TRANSFORMED',
  SENT: 'SENT',
  QUEUED: 'QUEUED',
  ERROR: 'ERROR',
  PENDING: 'PENDING',
} as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

// --- Content Types ---

export const CONTENT_TYPE = {
  RAW: 1,
  PROCESSED: 2,
  TRANSFORMED: 3,
  ENCODED: 4,
  SENT: 5,
  RESPONSE: 6,
  RESPONSE_TRANSFORMED: 7,
  RESPONSE_SENT: 8,
  SOURCE_MAP: 9,
  CHANNEL_MAP: 10,
  ERROR: 11,
  RESPONSE_ERROR: 12,
  PROCESSING_ERROR: 13,
} as const;
export type ContentType = (typeof CONTENT_TYPE)[keyof typeof CONTENT_TYPE];

// --- Filter ---

export const RULE_OPERATOR = {
  NONE: 'NONE',
  AND: 'AND',
  OR: 'OR',
} as const;
export type RuleOperator = (typeof RULE_OPERATOR)[keyof typeof RULE_OPERATOR];

export const FILTER_RULE_TYPE = {
  JAVASCRIPT: 'JAVASCRIPT',
  RULE_BUILDER: 'RULE_BUILDER',
  EXTERNAL_SCRIPT: 'EXTERNAL_SCRIPT',
} as const;
export type FilterRuleType = (typeof FILTER_RULE_TYPE)[keyof typeof FILTER_RULE_TYPE];

// --- Transformer ---

export const TRANSFORMER_STEP_TYPE = {
  JAVASCRIPT: 'JAVASCRIPT',
  MAPPER: 'MAPPER',
  MESSAGE_BUILDER: 'MESSAGE_BUILDER',
  XSLT: 'XSLT',
  EXTERNAL_SCRIPT: 'EXTERNAL_SCRIPT',
} as const;
export type TransformerStepType =
  (typeof TRANSFORMER_STEP_TYPE)[keyof typeof TRANSFORMER_STEP_TYPE];

// --- Code Templates ---

export const CODE_TEMPLATE_TYPE = {
  FUNCTION: 'FUNCTION',
  CODE_BLOCK: 'CODE_BLOCK',
} as const;
export type CodeTemplateType = (typeof CODE_TEMPLATE_TYPE)[keyof typeof CODE_TEMPLATE_TYPE];

export const CODE_TEMPLATE_CONTEXT = {
  GLOBAL_DEPLOY: 'GLOBAL_DEPLOY',
  GLOBAL_UNDEPLOY: 'GLOBAL_UNDEPLOY',
  GLOBAL_PREPROCESSOR: 'GLOBAL_PREPROCESSOR',
  GLOBAL_POSTPROCESSOR: 'GLOBAL_POSTPROCESSOR',
  CHANNEL_DEPLOY: 'CHANNEL_DEPLOY',
  CHANNEL_UNDEPLOY: 'CHANNEL_UNDEPLOY',
  CHANNEL_PREPROCESSOR: 'CHANNEL_PREPROCESSOR',
  CHANNEL_POSTPROCESSOR: 'CHANNEL_POSTPROCESSOR',
  CHANNEL_ATTACHMENT: 'CHANNEL_ATTACHMENT',
  CHANNEL_BATCH: 'CHANNEL_BATCH',
  SOURCE_RECEIVER: 'SOURCE_RECEIVER',
  SOURCE_FILTER_TRANSFORMER: 'SOURCE_FILTER_TRANSFORMER',
  DESTINATION_FILTER_TRANSFORMER: 'DESTINATION_FILTER_TRANSFORMER',
  DESTINATION_DISPATCHER: 'DESTINATION_DISPATCHER',
  DESTINATION_RESPONSE_TRANSFORMER: 'DESTINATION_RESPONSE_TRANSFORMER',
} as const;
export type CodeTemplateContext =
  (typeof CODE_TEMPLATE_CONTEXT)[keyof typeof CODE_TEMPLATE_CONTEXT];

// --- Alerts ---

export const ERROR_EVENT_TYPE = {
  ANY: 'ANY',
  SOURCE_CONNECTOR: 'SOURCE_CONNECTOR',
  DESTINATION_CONNECTOR: 'DESTINATION_CONNECTOR',
  FILTER: 'FILTER',
  TRANSFORMER: 'TRANSFORMER',
  DEPLOY_SCRIPT: 'DEPLOY_SCRIPT',
  PREPROCESSOR_SCRIPT: 'PREPROCESSOR_SCRIPT',
  POSTPROCESSOR_SCRIPT: 'POSTPROCESSOR_SCRIPT',
  UNDEPLOY_SCRIPT: 'UNDEPLOY_SCRIPT',
} as const;
export type ErrorEventType = (typeof ERROR_EVENT_TYPE)[keyof typeof ERROR_EVENT_TYPE];

// --- Channel Scripts ---

export const CHANNEL_SCRIPT_TYPE = {
  PREPROCESSOR: 'PREPROCESSOR',
  POSTPROCESSOR: 'POSTPROCESSOR',
  DEPLOY: 'DEPLOY',
  UNDEPLOY: 'UNDEPLOY',
  ATTACHMENT: 'ATTACHMENT',
} as const;
export type ChannelScriptType = (typeof CHANNEL_SCRIPT_TYPE)[keyof typeof CHANNEL_SCRIPT_TYPE];

// --- Metadata Column Types ---

export const METADATA_COLUMN_TYPE = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  TIMESTAMP: 'TIMESTAMP',
} as const;
export type MetadataColumnType = (typeof METADATA_COLUMN_TYPE)[keyof typeof METADATA_COLUMN_TYPE];

// --- User Roles ---

export const USER_ROLE = {
  ADMIN: 'admin',
  DEPLOYER: 'deployer',
  DEVELOPER: 'developer',
  VIEWER: 'viewer',
} as const;
export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

// --- Event Levels ---

export const EVENT_LEVEL = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;
export type EventLevel = (typeof EVENT_LEVEL)[keyof typeof EVENT_LEVEL];

export const EVENT_OUTCOME = {
  SUCCESS: 'SUCCESS',
  FAILURE: 'FAILURE',
} as const;
export type EventOutcome = (typeof EVENT_OUTCOME)[keyof typeof EVENT_OUTCOME];

// --- Global Script Types ---

export const GLOBAL_SCRIPT_TYPE = {
  DEPLOY: 'DEPLOY',
  UNDEPLOY: 'UNDEPLOY',
  PREPROCESSOR: 'PREPROCESSOR',
  POSTPROCESSOR: 'POSTPROCESSOR',
} as const;
export type GlobalScriptType = (typeof GLOBAL_SCRIPT_TYPE)[keyof typeof GLOBAL_SCRIPT_TYPE];
