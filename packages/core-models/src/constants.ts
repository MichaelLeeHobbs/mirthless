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

export const CONNECTOR_MODE = {
  SOURCE: 'SOURCE',
  DESTINATION: 'DESTINATION',
} as const;
export type ConnectorMode = (typeof CONNECTOR_MODE)[keyof typeof CONNECTOR_MODE];

// The one list of connector types per direction. They must equal the factory
// keys in packages/connectors/src/registry.ts; a connectors test asserts it.

export const SOURCE_CONNECTOR_TYPES = [
  'TCP_MLLP',
  'HTTP',
  'FILE',
  'DATABASE',
  'JAVASCRIPT',
  'CHANNEL',
  'DICOM',
  'EMAIL',
  'SFTP',
  'KAFKA',
  'AMQP',
] as const;
export type SourceConnectorType = (typeof SOURCE_CONNECTOR_TYPES)[number];

export const DESTINATION_CONNECTOR_TYPES = [
  'TCP_MLLP',
  'HTTP',
  'FILE',
  'DATABASE',
  'JAVASCRIPT',
  'SMTP',
  'CHANNEL',
  'FHIR',
  'DICOM',
  'SFTP',
  'KAFKA',
  'AMQP',
] as const;
export type DestinationConnectorType = (typeof DESTINATION_CONNECTOR_TYPES)[number];

export type ConnectorType = SourceConnectorType | DestinationConnectorType;

export function isSourceConnectorType(type: string): type is SourceConnectorType {
  return (SOURCE_CONNECTOR_TYPES as readonly string[]).includes(type);
}

export function isDestinationConnectorType(type: string): type is DestinationConnectorType {
  return (DESTINATION_CONNECTOR_TYPES as readonly string[]).includes(type);
}

export const CONNECTOR_TYPES = [
  ...SOURCE_CONNECTOR_TYPES,
  ...DESTINATION_CONNECTOR_TYPES.filter((t) => !isSourceConnectorType(t)),
] as unknown as readonly [ConnectorType, ...ConnectorType[]];

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

export const DATA_TYPE = {
  RAW: 'RAW',
  HL7V2: 'HL7V2',
  HL7V3: 'HL7V3',
  XML: 'XML',
  JSON: 'JSON',
  DICOM: 'DICOM',
  DELIMITED: 'DELIMITED',
  FHIR: 'FHIR',
  X12: 'X12',
} as const;
export type DataType = (typeof DATA_TYPE)[keyof typeof DATA_TYPE];

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

/** Every stored message's content is keyed by these numbers, so one never changes. */
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
  /** A destination's merged map variables, not only its channel map. */
  CHANNEL_MAP: 10,
  ERROR: 11,
  RESPONSE_ERROR: 12,
  PROCESSING_ERROR: 13,
  /** Of the connector's scripts (scripting/script-log.ts). */
  SCRIPT_LOG: 14,
  /**
   * On a Channel Writer's message: the message the target channel recorded for the send under way,
   * written by the target and removed when the send returns (D-397). Not content: no PHI, never encrypted.
   */
  HAND_OFF: 15,
} as const;
export type ContentType = (typeof CONTENT_TYPE)[keyof typeof CONTENT_TYPE];

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

export const TRANSFORMER_STEP_TYPE = {
  JAVASCRIPT: 'JAVASCRIPT',
  MAPPER: 'MAPPER',
  MESSAGE_BUILDER: 'MESSAGE_BUILDER',
  XSLT: 'XSLT',
  EXTERNAL_SCRIPT: 'EXTERNAL_SCRIPT',
} as const;
export type TransformerStepType =
  (typeof TRANSFORMER_STEP_TYPE)[keyof typeof TRANSFORMER_STEP_TYPE];

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

/**
 * Placeholders an alert's subject and body templates may use, written `${name}`.
 * The engine substitutes exactly these and the editor lists exactly these.
 */
export const ALERT_TEMPLATE_VARIABLES = [
  { name: 'alertName', description: 'Name of the alert' },
  { name: 'channelName', description: 'Name of the channel that raised the error' },
  { name: 'channelId', description: 'ID of the channel that raised the error' },
  { name: 'errorType', description: 'Kind of error, e.g. SOURCE_CONNECTOR or NO_MESSAGES' },
  { name: 'errorMessage', description: 'The error message' },
  { name: 'timestamp', description: 'When the error happened (ISO 8601, UTC)' },
] as const;
export type AlertTemplateVariable = (typeof ALERT_TEMPLATE_VARIABLES)[number]['name'];

export const CHANNEL_SCRIPT_TYPE = {
  PREPROCESSOR: 'PREPROCESSOR',
  POSTPROCESSOR: 'POSTPROCESSOR',
  DEPLOY: 'DEPLOY',
  UNDEPLOY: 'UNDEPLOY',
  ATTACHMENT: 'ATTACHMENT',
} as const;
export type ChannelScriptType = (typeof CHANNEL_SCRIPT_TYPE)[keyof typeof CHANNEL_SCRIPT_TYPE];

export const METADATA_COLUMN_TYPE = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  TIMESTAMP: 'TIMESTAMP',
} as const;
export type MetadataColumnType = (typeof METADATA_COLUMN_TYPE)[keyof typeof METADATA_COLUMN_TYPE];

/** docs/user/access-control.md must carry this word for word; a docs guard checks it. */
export const SCOPE_PROMISE =
  'Scope limits what a person or key can see and change through GalvaniGraph\'s screens and API. '
  + 'Message reads, searches and exports, and the reads listed under "What is recorded", are recorded in an audit log that the product can\'t change or delete; '
  + 'each entry there says whether the read is refused when it can\'t be recorded or recorded on a best-effort basis. '
  + 'Reads under "What is not audited" aren\'t. '
  + 'Scope is not a boundary for code: anyone who can change or deploy channel code, code templates or global scripts, or restore a backup, '
  + 'can reach every channel\'s messages and credentials through that code, and that reach is not recorded. '
  + 'A database owner can still alter the audit log.';

export const USER_ROLE = {
  ADMIN: 'admin',
  DEPLOYER: 'deployer',
  DEVELOPER: 'developer',
  VIEWER: 'viewer',
} as const;
export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

// The one list of permission strings (resource:action).

export const PERMISSIONS = {
  CHANNELS_READ: 'channels:read',
  CHANNELS_WRITE: 'channels:write',
  CHANNELS_DEPLOY: 'channels:deploy',
  CHANNELS_DELETE: 'channels:delete',

  MESSAGES_READ: 'messages:read',
  MESSAGES_REPROCESS: 'messages:reprocess',
  MESSAGES_DELETE: 'messages:delete',

  CODE_TEMPLATES_READ: 'code_templates:read',
  CODE_TEMPLATES_WRITE: 'code_templates:write',
  CODE_TEMPLATES_DELETE: 'code_templates:delete',

  ALERTS_READ: 'alerts:read',
  ALERTS_WRITE: 'alerts:write',
  ALERTS_DELETE: 'alerts:delete',

  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_DELETE: 'users:delete',

  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',

  EVENTS_READ: 'events:read',

  RESOURCES_READ: 'resources:read',
  RESOURCES_WRITE: 'resources:write',
  RESOURCES_DELETE: 'resources:delete',

  COLLECTIONS_READ: 'collections:read',
  COLLECTIONS_WRITE: 'collections:write',
  COLLECTIONS_DELETE: 'collections:delete',

  DATASOURCES_READ: 'datasources:read',
  DATASOURCES_WRITE: 'datasources:write',
  DATASOURCES_DELETE: 'datasources:delete',

  GLOBAL_SCRIPTS_READ: 'global_scripts:read',
  GLOBAL_SCRIPTS_WRITE: 'global_scripts:write',

  GLOBAL_MAP_READ: 'global_map:read',
  GLOBAL_MAP_WRITE: 'global_map:write',

  CONFIG_MAP_READ: 'config_map:read',
  CONFIG_MAP_WRITE: 'config_map:write',

  SYSTEM_INFO: 'system:info',
  SYSTEM_BACKUP: 'system:backup',
  SYSTEM_RESTORE: 'system:restore',

  /** The protected audit log (D-312). */
  AUDIT_READ: 'audit:read',

  ROLES_READ: 'roles:read',
  /** Within what the editor holds (D-310). */
  ROLES_WRITE: 'roles:write',

  /** Never the secret (D-313). */
  API_KEYS_READ: 'api_keys:read',
  /** Within what the holder holds (D-313). */
  API_KEYS_MANAGE: 'api_keys:manage',
} as const;
export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** What a users row is: a person, or the principal behind an API key (D-313, D-320). */
export const USER_KIND = {
  PERSON: 'person',
  API_KEY: 'api_key',
} as const;
export type UserKind = (typeof USER_KIND)[keyof typeof USER_KIND];

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

export const GLOBAL_SCRIPT_TYPE = {
  DEPLOY: 'DEPLOY',
  UNDEPLOY: 'UNDEPLOY',
  PREPROCESSOR: 'PREPROCESSOR',
  POSTPROCESSOR: 'POSTPROCESSOR',
} as const;
export type GlobalScriptType = (typeof GLOBAL_SCRIPT_TYPE)[keyof typeof GLOBAL_SCRIPT_TYPE];

export const DEFAULT_GROUP_NAME = 'Default';

export const SOCKET_EVENT = {
  CHANNEL_STATE: 'channel:state',
  STATS_UPDATE: 'stats:update',
  MESSAGE_NEW: 'message:new',
  SERVER_LOG: 'server:log',
} as const;
export type SocketEvent = (typeof SOCKET_EVENT)[keyof typeof SOCKET_EVENT];

/** Why the server refused a socket's handshake. The web signs out only for the first (#473). */
export const SOCKET_ERROR = {
  AUTH_REQUIRED: 'Authentication required',
  UNAVAILABLE: 'Server unavailable',
} as const;
