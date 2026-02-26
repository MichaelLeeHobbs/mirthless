# 01 — Core Models

> Domain types, Zod schemas, and branded types for Mirthless.

## Design Principles

1. **Immutable by default** — All properties `readonly`. Mutations create new objects.
2. **Validated at boundaries** — Zod schemas for every type. Factory functions return `Result<T>`.
3. **Branded IDs** — `ChannelId`, `ConnectorId`, `MessageId`, `UserId` prevent accidental mixing.
4. **Discriminated unions** — Connector properties, transformer steps, filter rules use `type` discriminant.
5. **No `any`** — `unknown` + type guards everywhere.
6. **JSON-native** — No XML serialization layer. Zod schemas serve as both runtime validation and documentation.

---

## Branded Types

```typescript
// packages/core-models/src/branded.ts
declare const __brand: unique symbol;
type Brand<T, TBrand extends string> = T & { readonly [__brand]: TBrand };
type BrandedString<TBrand extends string> = Brand<string, TBrand>;

// Domain IDs — all UUIDs
type ChannelId = BrandedString<'ChannelId'>;
type ConnectorId = BrandedString<'ConnectorId'>;
type MessageId = BrandedString<'MessageId'>;
type UserId = BrandedString<'UserId'>;
type AlertId = BrandedString<'AlertId'>;
type CodeTemplateId = BrandedString<'CodeTemplateId'>;
type CodeTemplateLibraryId = BrandedString<'CodeTemplateLibraryId'>;
type ChannelGroupId = BrandedString<'ChannelGroupId'>;
type TagId = BrandedString<'TagId'>;
type ServerId = BrandedString<'ServerId'>;

// Numeric branded types
type BrandedNumber<TBrand extends string> = Brand<number, TBrand>;
type MetaDataId = BrandedNumber<'MetaDataId'>; // 0 = source, 1+ = destinations
type Revision = BrandedNumber<'Revision'>;
```

Each gets a factory: `createChannelId(value: string): Result<ChannelId>` that validates UUID format.

---

## Channel

Connect's central entity. We keep the concept but fix the structure.

### What Connect Has (Problems)

- Fully mutable with public setters
- `nextMetaDataId` counter for auto-assigning destination IDs
- Scripts stored as raw strings with no validation
- `exportData` lazily initialized nullable field
- Shallow `clone()` method

### Our Design

```typescript
const CHANNEL_STATE = {
  UNDEPLOYED: 'UNDEPLOYED',
  STARTED: 'STARTED',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
} as const;
type ChannelState = typeof CHANNEL_STATE[keyof typeof CHANNEL_STATE];

const MESSAGE_STORAGE_MODE = {
  DEVELOPMENT: 'DEVELOPMENT', // Store everything (full reprocessing support)
  PRODUCTION: 'PRODUCTION',   // Store transformed + encoded + sent (reprocess from transformed)
  RAW: 'RAW',                 // Store raw only (reprocess from raw)
  METADATA: 'METADATA',       // Store metadata only (no reprocessing)
  DISABLED: 'DISABLED',       // Store nothing (statistics only)
} as const;
type MessageStorageMode = typeof MESSAGE_STORAGE_MODE[keyof typeof MESSAGE_STORAGE_MODE];

// Content stored per mode (✓ = stored, ✗ = skipped):
//
// | Content Type      | DEVELOPMENT | PRODUCTION | RAW | METADATA | DISABLED |
// |-------------------|:-----------:|:----------:|:---:|:--------:|:--------:|
// | Raw               |      ✓      |     ✓      |  ✓  |    ✗     |    ✗     |
// | Processed Raw     |      ✓      |     ✗      |  ✗  |    ✗     |    ✗     |
// | Transformed       |      ✓      |     ✓      |  ✗  |    ✗     |    ✗     |
// | Encoded           |      ✓      |     ✓      |  ✗  |    ✗     |    ✗     |
// | Sent              |      ✓      |     ✓      |  ✗  |    ✗     |    ✗     |
// | Response          |      ✓      |     ✓      |  ✗  |    ✗     |    ✗     |
// | Response Xformed  |      ✓      |     ✗      |  ✗  |    ✗     |    ✗     |
// | Maps              |      ✓      |     ✓      |  ✗  |    ✗     |    ✗     |
// | Errors            |      ✓      |     ✓      |  ✓  |    ✓     |    ✗     |
// | Custom Metadata   |      ✓      |     ✓      |  ✓  |    ✓     |    ✗     |
// | Connector Status  |      ✓      |     ✓      |  ✓  |    ✓     |    ✗     |

interface Channel {
  readonly id: ChannelId;
  readonly name: string;
  readonly description: string;
  readonly revision: Revision;
  readonly enabled: boolean;
  readonly sourceConnector: SourceConnector;
  readonly destinationConnectors: ReadonlyArray<DestinationConnector>;
  readonly properties: ChannelProperties;
  readonly scripts: ChannelScripts;
  readonly tags: ReadonlyArray<TagId>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface ChannelProperties {
  readonly initialState: ChannelState;
  readonly messageStorageMode: MessageStorageMode;
  readonly encryptData: boolean;
  readonly removeContentOnCompletion: boolean;
  readonly removeAttachmentsOnCompletion: boolean;
  readonly storeAttachments: boolean;
  readonly metadataColumns: ReadonlyArray<MetadataColumnDefinition>;
}

interface ChannelScripts {
  readonly deploy: string | null;
  readonly undeploy: string | null;
  readonly preprocessor: string | null;
  readonly postprocessor: string | null;
}

interface MetadataColumnDefinition {
  readonly name: string;
  readonly type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'TIMESTAMP';
  readonly mappingName: string; // Variable name in maps
}
```

### Key Differences from Connect

| Aspect | Connect | Mirthless |
|---|---|---|
| Mutability | All mutable | All `readonly` |
| MetaDataId assignment | Auto-increment counter on Channel | Each connector has its own `ConnectorId`; `metaDataId` is assigned at deployment time |
| Scripts | Raw strings, no types | Nullable strings, validated at save time |
| Properties | Mixed into ChannelProperties blob | Separated: `ChannelProperties` + `ChannelScripts` |
| Tags | `Set<String>` channelIds on Tag | `ReadonlyArray<TagId>` on Channel |
| Export data | Lazy-init `ChannelExportData` | Not a model concern — export is a server operation |

---

## Connector

Connect uses a single concrete `Connector` class for both source and destination, distinguished by a `mode` enum. This is weak typing. We use separate types.

### Our Design

```typescript
const CONNECTOR_MODE = {
  SOURCE: 'SOURCE',
  DESTINATION: 'DESTINATION',
} as const;
type ConnectorMode = typeof CONNECTOR_MODE[keyof typeof CONNECTOR_MODE];

// Base fields shared by source and destination
interface ConnectorBase {
  readonly id: ConnectorId;
  readonly name: string;
  readonly enabled: boolean;
  readonly filter: Filter;
  readonly transformer: Transformer;
}

// How the source connector constructs its response to the sender
const RESPONSE_MODE = {
  NONE: 'NONE',                             // No response
  AUTO_BEFORE: 'AUTO_BEFORE',               // Auto-generate immediately (before processing)
  AUTO_AFTER_TRANSFORMER: 'AUTO_AFTER_TRANSFORMER', // Auto-generate after source transformer
  AUTO_AFTER_DESTINATIONS: 'AUTO_AFTER_DESTINATIONS', // Auto-generate after all destinations complete
  POSTPROCESSOR: 'POSTPROCESSOR',           // Use postprocessor return value as response
  DESTINATION: 'DESTINATION',               // Use response from a specific destination connector
} as const;
type ResponseMode = typeof RESPONSE_MODE[keyof typeof RESPONSE_MODE];

interface SourceConnector extends ConnectorBase {
  readonly mode: typeof CONNECTOR_MODE.SOURCE;
  readonly metaDataId: 0; // Always 0
  readonly properties: SourceConnectorProperties;
  readonly responseMode: ResponseMode;
  readonly responseConnectorName: string | null; // Only used when responseMode is DESTINATION
}

interface DestinationConnector extends ConnectorBase {
  readonly mode: typeof CONNECTOR_MODE.DESTINATION;
  readonly metaDataId: MetaDataId; // 1+
  readonly properties: DestinationConnectorProperties;
  readonly responseTransformer: Transformer | null;
  readonly waitForPrevious: boolean;
}

type Connector = SourceConnector | DestinationConnector;

// Destination queue behavior
const QUEUE_MODE = {
  NEVER: 'NEVER',           // No queuing; send fails → immediate ERROR
  ON_FAILURE: 'ON_FAILURE', // Try send first; on failure → queue for retry
  ALWAYS: 'ALWAYS',         // Always queue first, then send from queue (guarantees ordering)
} as const;
type QueueMode = typeof QUEUE_MODE[keyof typeof QUEUE_MODE];
```

### Connector Properties (Discriminated Union)

Connect uses `ConnectorProperties` as an abstract base with `@class` as discriminator. We use TypeScript discriminated unions.

```typescript
const CONNECTOR_TYPE = {
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
type ConnectorType = typeof CONNECTOR_TYPE[keyof typeof CONNECTOR_TYPE];

// Source properties
type SourceConnectorProperties =
  | TcpListenerProperties
  | HttpListenerProperties
  | FileReaderProperties
  | DatabaseReaderProperties
  | JavaScriptReaderProperties
  | ChannelReaderProperties
  | DicomListenerProperties;

// Destination properties
type DestinationConnectorProperties =
  | TcpSenderProperties
  | HttpSenderProperties
  | FileWriterProperties
  | DatabaseWriterProperties
  | JavaScriptWriterProperties
  | ChannelWriterProperties
  | DicomSenderProperties
  | SmtpSenderProperties
  | FhirClientProperties;

// Example: TCP/MLLP listener
interface TcpListenerProperties {
  readonly type: typeof CONNECTOR_TYPE.TCP_MLLP;
  readonly role: 'source';
  readonly host: string;
  readonly port: number;
  readonly maxConnections: number;
  readonly receiveTimeout: number;
  readonly bufferSize: number;
  readonly keepConnectionOpen: boolean;
  readonly charset: string;
  readonly transmissionMode: TransmissionMode;
  readonly tls: TlsOptions | null;
  // Source-specific
  readonly processingThreads: number;
  readonly batchMode: boolean;
}

// Example: HTTP sender
interface HttpSenderProperties {
  readonly type: typeof CONNECTOR_TYPE.HTTP;
  readonly role: 'destination';
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly headers: ReadonlyArray<{ readonly name: string; readonly value: string }>;
  readonly contentType: string;
  readonly charset: string;
  readonly body: string; // Template with ${variable} substitution
  readonly timeout: number;
  readonly authentication: HttpAuthentication | null;
  readonly proxy: HttpProxy | null;
  // Destination queue behavior
  readonly queueMode: QueueMode;  // NEVER | ON_FAILURE | ALWAYS
  readonly retryCount: number;
  readonly retryIntervalMs: number;
  readonly queueThreadCount: number;
  readonly rotateQueue: boolean;
}
```

---

## Filter

```typescript
const RULE_OPERATOR = {
  NONE: 'NONE', // First rule in the list
  AND: 'AND',
  OR: 'OR',
} as const;
type RuleOperator = typeof RULE_OPERATOR[keyof typeof RULE_OPERATOR];

interface Filter {
  readonly rules: ReadonlyArray<FilterRule>;
}

// Discriminated union for rule types
const FILTER_RULE_TYPE = {
  JAVASCRIPT: 'JAVASCRIPT',
  RULE_BUILDER: 'RULE_BUILDER',
  EXTERNAL_SCRIPT: 'EXTERNAL_SCRIPT',
} as const;

type FilterRule = JavaScriptFilterRule | RuleBuilderFilterRule | ExternalScriptFilterRule;

interface FilterRuleBase {
  readonly name: string;
  readonly sequenceNumber: number;
  readonly enabled: boolean;
  readonly operator: RuleOperator;
}

interface JavaScriptFilterRule extends FilterRuleBase {
  readonly type: typeof FILTER_RULE_TYPE.JAVASCRIPT;
  readonly script: string;
}

interface RuleBuilderFilterRule extends FilterRuleBase {
  readonly type: typeof FILTER_RULE_TYPE.RULE_BUILDER;
  readonly field: string;
  readonly condition: 'EQUALS' | 'NOT_EQUALS' | 'CONTAINS' | 'NOT_CONTAINS' | 'EXISTS' | 'NOT_EXISTS' | 'REGEX';
  readonly values: ReadonlyArray<string>;
}

interface ExternalScriptFilterRule extends FilterRuleBase {
  readonly type: typeof FILTER_RULE_TYPE.EXTERNAL_SCRIPT;
  readonly scriptPath: string;
}
```

---

## Transformer

```typescript
const DATA_TYPE = {
  RAW: 'RAW',
  HL7V2: 'HL7V2',
  HL7V3: 'HL7V3',
  XML: 'XML',
  JSON: 'JSON',
  DICOM: 'DICOM',
  DELIMITED: 'DELIMITED',
  FHIR: 'FHIR',
} as const;
type DataType = typeof DATA_TYPE[keyof typeof DATA_TYPE];

interface Transformer {
  readonly inboundDataType: DataType;
  readonly outboundDataType: DataType;
  readonly inboundProperties: DataTypeProperties;
  readonly outboundProperties: DataTypeProperties;
  readonly steps: ReadonlyArray<TransformerStep>;
}

// Discriminated union — each data type has its own serialization/deserialization properties
type DataTypeProperties =
  | Hl7v2DataTypeProperties
  | XmlDataTypeProperties
  | JsonDataTypeProperties
  | DelimitedDataTypeProperties
  | FhirDataTypeProperties
  | DicomDataTypeProperties
  | RawDataTypeProperties
  | Hl7v3DataTypeProperties;

interface Hl7v2DataTypeProperties {
  readonly type: typeof DATA_TYPE.HL7V2;
  readonly useStrictParser: boolean;        // Parse per strict HL7 spec (default: false)
  readonly handleRepetitions: boolean;      // Parse field repetitions (default: true)
  readonly handleSubcomponents: boolean;    // Parse subcomponents (default: true)
  readonly convertLineBreaks: boolean;      // Convert \n to \r (default: true)
  readonly segmentDelimiter: string;        // Default: '\r'
}

interface XmlDataTypeProperties {
  readonly type: typeof DATA_TYPE.XML;
  readonly stripNamespaces: boolean;        // Remove namespace prefixes (default: false)
}

interface JsonDataTypeProperties {
  readonly type: typeof DATA_TYPE.JSON;
  // Minimal — JSON is native to V8. No parsing options needed.
}

interface DelimitedDataTypeProperties {
  readonly type: typeof DATA_TYPE.DELIMITED;
  readonly columnDelimiter: string;         // Default: ','
  readonly rowDelimiter: string;            // Default: '\n'
  readonly quoteChar: string;              // Default: '"'
  readonly escapeWithDoubleQuote: boolean;  // Default: true
  readonly columnNames: ReadonlyArray<string>; // Empty = no header / use first row
  readonly numberColumns: number;           // 0 = auto-detect
  readonly ignoreCR: boolean;              // Default: false
}

interface FhirDataTypeProperties {
  readonly type: typeof DATA_TYPE.FHIR;
  readonly fhirVersion: 'R4' | 'R5';       // Default: 'R4'
}

interface DicomDataTypeProperties {
  readonly type: typeof DATA_TYPE.DICOM;
  // DICOM parsing is binary — no configurable text options
}

interface RawDataTypeProperties {
  readonly type: typeof DATA_TYPE.RAW;
  // Pass-through — no serialization/deserialization
}

interface Hl7v3DataTypeProperties {
  readonly type: typeof DATA_TYPE.HL7V3;
  readonly stripNamespaces: boolean;        // CDA documents are XML. Default: false
}

// Discriminated union for step types
const TRANSFORMER_STEP_TYPE = {
  JAVASCRIPT: 'JAVASCRIPT',
  MAPPER: 'MAPPER',
  MESSAGE_BUILDER: 'MESSAGE_BUILDER',
  XSLT: 'XSLT',
  EXTERNAL_SCRIPT: 'EXTERNAL_SCRIPT',
} as const;

type TransformerStep =
  | JavaScriptTransformerStep
  | MapperStep
  | MessageBuilderStep
  | XsltStep
  | ExternalScriptStep;

interface TransformerStepBase {
  readonly name: string;
  readonly sequenceNumber: number;
  readonly enabled: boolean;
}

interface JavaScriptTransformerStep extends TransformerStepBase {
  readonly type: typeof TRANSFORMER_STEP_TYPE.JAVASCRIPT;
  readonly script: string;
}

interface MapperStep extends TransformerStepBase {
  readonly type: typeof TRANSFORMER_STEP_TYPE.MAPPER;
  readonly variable: string;
  readonly mapping: string; // Expression like msg['PID']['PID.3']
  readonly defaultValue: string | null;
}

interface MessageBuilderStep extends TransformerStepBase {
  readonly type: typeof TRANSFORMER_STEP_TYPE.MESSAGE_BUILDER;
  readonly variable: string;
  readonly mapping: string;
  readonly defaultValue: string | null;
}
```

---

## Message

Connect's `ConnectorMessage` is a 30+ field god class. We decompose it.

```typescript
const MESSAGE_STATUS = {
  RECEIVED: 'RECEIVED',
  FILTERED: 'FILTERED',
  TRANSFORMED: 'TRANSFORMED',
  SENT: 'SENT',
  QUEUED: 'QUEUED',
  ERROR: 'ERROR',
  PENDING: 'PENDING',
} as const;
type MessageStatus = typeof MESSAGE_STATUS[keyof typeof MESSAGE_STATUS];

// Top-level message (one per channel dispatch)
interface Message {
  readonly id: MessageId;
  readonly channelId: ChannelId;
  readonly serverId: ServerId;
  readonly receivedDate: Date;
  readonly processed: boolean;
  readonly connectorMessages: ReadonlyMap<MetaDataId, ConnectorMessage>;
}

// Per-connector processing state
interface ConnectorMessage {
  readonly messageId: MessageId;
  readonly channelId: ChannelId;
  readonly metaDataId: MetaDataId;
  readonly connectorName: string;
  readonly status: MessageStatus;
  readonly receivedDate: Date;
  readonly sendDate: Date | null;
  readonly responseDate: Date | null;
  readonly sendAttempts: number;
  readonly errorCode: number; // Bitmask
  readonly content: MessageContent;
  readonly maps: MessageMaps;
  readonly errors: MessageErrors;
}

// Content decomposed from ConnectorMessage's 8 flat fields
interface MessageContent {
  readonly raw: string | null;
  readonly processedRaw: string | null;
  readonly transformed: string | null;
  readonly encoded: string | null;
  readonly sent: string | null;
  readonly response: string | null;
  readonly responseTransformed: string | null;
  readonly processedResponse: string | null;
}

// Maps decomposed from ConnectorMessage's stored maps
// Note: globalMap, globalChannelMap, and configMap are NOT stored per-message.
// They are runtime-scoped maps injected into the sandbox at execution time.
// See 04-transformer-sandbox.md for the full map hierarchy.
interface MessageMaps {
  readonly sourceMap: Readonly<Record<string, unknown>>;
  readonly channelMap: Readonly<Record<string, unknown>>;
  readonly connectorMap: Readonly<Record<string, unknown>>;
  readonly responseMap: Readonly<Record<string, unknown>>;
}

// Errors decomposed from ConnectorMessage's 3 flat fields
interface MessageErrors {
  readonly processingError: string | null;
  readonly postProcessorError: string | null;
  readonly responseError: string | null;
}
```

---

## Code Templates

```typescript
const CODE_TEMPLATE_TYPE = {
  FUNCTION: 'FUNCTION',
  CODE_BLOCK: 'CODE_BLOCK',
} as const;
type CodeTemplateType = typeof CODE_TEMPLATE_TYPE[keyof typeof CODE_TEMPLATE_TYPE];

// 15 pipeline contexts where templates can be used
const CODE_TEMPLATE_CONTEXT = {
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
type CodeTemplateContext = typeof CODE_TEMPLATE_CONTEXT[keyof typeof CODE_TEMPLATE_CONTEXT];

interface CodeTemplate {
  readonly id: CodeTemplateId;
  readonly name: string;
  readonly revision: Revision;
  readonly type: CodeTemplateType;
  readonly code: string;
  readonly contexts: ReadonlySet<CodeTemplateContext>;
  readonly lastModified: Date;
}

interface CodeTemplateLibrary {
  readonly id: CodeTemplateLibraryId;
  readonly name: string;
  readonly description: string;
  readonly revision: Revision;
  readonly includeNewChannels: boolean;
  readonly enabledChannelIds: ReadonlySet<ChannelId>;
  readonly disabledChannelIds: ReadonlySet<ChannelId>;
  readonly codeTemplates: ReadonlyArray<CodeTemplate>;
  readonly lastModified: Date;
}
```

---

## Alert

```typescript
interface Alert {
  readonly id: AlertId;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: AlertTrigger;
  readonly actionGroups: ReadonlyArray<AlertActionGroup>;
}

// Discriminated union for triggers
type AlertTrigger = ChannelErrorTrigger; // Extensible — add more trigger types later

interface ChannelErrorTrigger {
  readonly type: 'CHANNEL_ERROR';
  readonly errorTypes: ReadonlySet<ErrorEventType>;
  readonly channelIds: ReadonlySet<ChannelId> | 'ALL';
  readonly regex: string | null;
}

const ERROR_EVENT_TYPE = {
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
type ErrorEventType = typeof ERROR_EVENT_TYPE[keyof typeof ERROR_EVENT_TYPE];

interface AlertActionGroup {
  readonly actions: ReadonlyArray<AlertAction>;
  readonly subject: string;
  readonly template: string;
}

type AlertAction = EmailAlertAction | ChannelAlertAction;

interface EmailAlertAction {
  readonly type: 'EMAIL';
  readonly recipient: string;
}

interface ChannelAlertAction {
  readonly type: 'CHANNEL';
  readonly channelId: ChannelId;
}
```

---

## User

Connect's User model has no RBAC. We build it in from the start.

```typescript
interface User {
  readonly id: UserId;
  readonly username: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// Roles and permissions — from fullstack-template patterns
interface Role {
  readonly id: string;
  readonly name: string;
  readonly permissions: ReadonlyArray<Permission>;
}

interface Permission {
  readonly resource: string; // e.g., 'channels', 'messages', 'users'
  readonly action: string;   // e.g., 'read', 'write', 'deploy', 'admin'
  readonly channelIds: ReadonlySet<ChannelId> | 'ALL'; // Channel-scoped permissions
}
```

---

## Channel Group and Tags

```typescript
interface ChannelGroup {
  readonly id: ChannelGroupId;
  readonly name: string;
  readonly description: string;
  readonly revision: Revision;
  readonly channelIds: ReadonlyArray<ChannelId>;
}

interface ChannelTag {
  readonly id: TagId;
  readonly name: string;
  readonly color: string; // Hex color, not java.awt.Color
  readonly channelIds: ReadonlySet<ChannelId>;
}

interface ChannelDependency {
  readonly dependentId: ChannelId;
  readonly dependencyId: ChannelId;
}
```

---

## Server Configuration

```typescript
interface ServerSettings {
  readonly serverId: ServerId;
  readonly serverName: string;
  readonly defaultAdminAddress: string;
  readonly smtpHost: string | null;
  readonly smtpPort: number;
  readonly smtpAuth: boolean;
  readonly smtpUsername: string | null;
  readonly clearGlobalMap: boolean;
  readonly queueBufferSize: number;
  readonly defaultMetadataColumns: ReadonlyArray<MetadataColumnDefinition>;
}

interface GlobalScripts {
  readonly deploy: string | null;
  readonly undeploy: string | null;
  readonly preprocessor: string | null;
  readonly postprocessor: string | null;
}
```

---

## Zod Schema Organization

Each type gets a Zod schema in the same file. Schemas are the single source of truth.

```typescript
// Example: channelSchema
const channelSchema = z.object({
  id: z.string().uuid().transform((v) => v as ChannelId),
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  revision: z.number().int().nonnegative().transform((v) => v as Revision),
  enabled: z.boolean().default(true),
  sourceConnector: sourceConnectorSchema,
  destinationConnectors: z.array(destinationConnectorSchema),
  properties: channelPropertiesSchema,
  scripts: channelScriptsSchema,
  tags: z.array(z.string().uuid().transform((v) => v as TagId)),
  createdAt: z.date(),
  updatedAt: z.date(),
});

type Channel = z.infer<typeof channelSchema>;
```

This gives us runtime validation, TypeScript types, and self-documenting schemas all in one.

---

## Channel Export/Import Format

Channels are exported as self-contained JSON documents for backup, migration between environments, and sharing.

```typescript
interface ChannelExport {
  readonly version: number;                          // Export format version (for forward compatibility)
  readonly exportedAt: string;                       // ISO 8601 timestamp
  readonly channel: Channel;                         // Full channel config
  readonly codeTemplateLibraries: ReadonlyArray<CodeTemplateLibrary>; // Referenced libraries (optional)
  readonly dependencies: ReadonlyArray<ChannelDependency>;            // Channel dependencies
  readonly tags: ReadonlyArray<ChannelTag>;           // Referenced tags
}

// Server-level backup includes everything
interface ServerBackup {
  readonly version: number;
  readonly exportedAt: string;
  readonly serverId: ServerId;
  readonly channels: ReadonlyArray<ChannelExport>;
  readonly channelGroups: ReadonlyArray<ChannelGroup>;
  readonly codeTemplateLibraries: ReadonlyArray<CodeTemplateLibrary>;
  readonly alerts: ReadonlyArray<Alert>;
  readonly globalScripts: GlobalScripts;
  readonly serverSettings: ServerSettings;
  readonly users: ReadonlyArray<Omit<User, 'passwordHash'>>; // Never export password hashes
  readonly configMap: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}
```

Import validates all entities with Zod before applying. On ID collision, the import dialog offers: skip, overwrite, or create as new (with new ID).

**Mirth XML import (P2):** A converter from Mirth's XML channel export format to our JSON format. This enables migration from existing Mirth installations. Parser reads XStream-serialized Java objects and maps them to our TypeScript models. Deferred to P2 because it requires mapping Connect's XML property names to our schema.

---

## Resolved Decisions

1. **JSONB + Zod for connector properties** — Connector properties stored as JSONB in the database. Each connector type exports its own Zod schema (e.g., `TcpListenerPropertiesSchema`). The `connectorType` discriminator determines which schema to apply. Validation happens at the application boundary (on save, on deploy), not at the database level. This gives JSONB flexibility with full type safety — no migrations needed when connector properties change.

2. **Separate `message_content` table + JSONB expression indexes for custom metadata** — Message content (raw, transformed, encoded, response, etc.) stored in a separate `message_content` table with one row per content type. This keeps the `connector_messages` table lean for fast index scans, and storage modes can selectively skip content types. Custom metadata stored as JSONB with expression indexes created per metadata column per channel. Users can opt in/out of indexing per column. This avoids Connect's performance problem (unindexed dynamic columns) while keeping the schema stable.

3. **Map serialization: JSONB with soft size warnings** — Maps (sourceMap, channelMap, connectorMap, responseMap) stored as JSONB. No hard size limit (would break user code). Soft warning emitted when a channel's average map payload exceeds a configurable threshold (default 1MB). Maps can be included in the "remove on completion" content removal policy. Server config: `mapSizeWarningThresholdBytes`.

4. **Revision integer + `updatedAt` for optimistic concurrency** — `revision` integer is the concurrency token. Updates increment revision and check `WHERE revision = expectedRevision`. If `rowCount === 0`, return a `ConflictError`. The `updatedAt` timestamp is for display and auditing, not concurrency control. Standard pattern used by etcd, Kubernetes, CouchDB.
