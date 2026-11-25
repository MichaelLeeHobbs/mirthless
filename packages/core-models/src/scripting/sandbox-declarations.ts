// packages/engine/sandbox-globals.d.ts declares the same surface; update both
// (sandbox-types-consistency.test.ts fails when their globals differ).

const SANDBOX_BASE = `
/**
 * HL7 message proxy returned by parseHL7().
 * Provides path-based access to HL7 fields.
 */
interface Hl7MessageProxy {
  /** Get the first value at an HL7 path (e.g., "MSH.9.1", "PID.3"). */
  get(path: string): string | undefined;
  /** Get everything at an HL7 path as encoded: the whole field, repetition or component. */
  getRaw(path: string): string | undefined;
  /** Get the decoded text at an HL7 path (escape sequences resolved). */
  getText(path: string): string | undefined;
  /** Replace whatever the path names (field, repetition, component or subcomponent) with the value. */
  set(path: string, value: string): void;
  /** Replace whatever the path names with free text; every delimiter is encoded. */
  setText(path: string, value: string): void;
  /** Delete a field by HL7 path. */
  delete(path: string): void;
  /** Serialize back to HL7 pipe-delimited format. */
  toString(): string;
  /** Message type (e.g., "ADT^A01"). */
  readonly messageType: string;
  /** Message control ID (MSH.10). */
  readonly messageControlId: string;
  /** Count of repeating segments by name (e.g., "OBX"). */
  getSegmentCount(name: string): number;
  /** Get raw segment string by name and optional repeat index. */
  getSegmentString(name: string, index?: number): string | undefined;
}

/** Sandbox logger with level-based methods. Any value is logged as text (String(value)). */
interface SandboxLogger {
  info(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
  debug(message: unknown): void;
}

/** Response from an HTTP fetch operation. */
interface HttpFetchResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** Result from a database query. */
interface DbQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
}

/** X12 message proxy (msg and tmp in an X12 channel). Path-based access, e.g. "NM1[3].9". */
interface X12MessageProxy {
  /** Get the value at an X12 path. */
  get(path: string): string | undefined;
  /** Set the value at an X12 path. */
  set(path: string, value: string): void;
  /** Delete the element at an X12 path. */
  delete(path: string): void;
  /** Count of segments with this id (e.g. "NM1"). */
  getSegmentCount(id: string): number;
  /** Serialize back to X12 text. */
  toString(): string;
}

// ----- Global Variables -----

/** Source system metadata. Propagates through the pipeline. */
declare var sourceMap: Record<string, unknown>;

/** Channel-scoped persistent state. Cleared on channel redeploy. */
declare var channelMap: Record<string, unknown>;

/** Connector-scoped state. Lifetime of the connector instance. */
declare var connectorMap: Record<string, unknown>;

/** Response data from destination sends. */
declare var responseMap: Record<string, unknown>;

/** Global map shared across all channels. */
declare var globalChannelMap: Record<string, unknown>;

/** Global map (persistent, shared across all channels). */
declare var globalMap: Record<string, unknown>;

/** Configuration map (read-only, frozen). Access via "category.key" format. */
declare var configMap: Readonly<Record<string, unknown>>;

/** Logger for sandbox scripts. */
declare var logger: SandboxLogger;

// ----- Map Shortcut Functions (Mirth-compatible) -----

/** Look a key up in responseMap, connectorMap, channelMap, globalChannelMap, globalMap, configMap, sourceMap (first defined wins). */
declare function $(key: string): unknown;
/** Get or set a channelMap entry. */
declare function $c(key: string): unknown;
declare function $c(key: string, value: unknown): void;
/** Get or set a connectorMap entry. */
declare function $co(key: string): unknown;
declare function $co(key: string, value: unknown): void;
/** Get or set a responseMap entry. */
declare function $r(key: string): unknown;
declare function $r(key: string, value: unknown): void;
/** Get or set a globalMap entry. */
declare function $g(key: string): unknown;
declare function $g(key: string, value: unknown): void;
/** Get or set a globalChannelMap entry. */
declare function $gc(key: string): unknown;
declare function $gc(key: string, value: unknown): void;
/** Get a sourceMap entry (read-only). */
declare function $s(key: string): unknown;
/** Get a configMap entry (read-only). */
declare function $cfg(key: string): unknown;

// ----- Global Functions -----

/**
 * Parse an HL7v2 message string into a proxy object.
 * @param raw Raw HL7 message string (pipe-delimited).
 * @returns Proxy with get/set/delete/toString methods.
 */
declare function parseHL7(raw: string): Hl7MessageProxy;

/**
 * Create an HL7 ACK message from the original raw message.
 * @param originalRaw The original HL7 message.
 * @param ackCode ACK code (e.g., "AA", "AE", "AR").
 * @param textMessage Optional text message for MSA.3.
 * @returns ACK message string.
 */
declare function createACK(originalRaw: string, ackCode: string, textMessage?: string): string;

/** A record stored in / returned from a collection. */
interface CollectionRecord {
  /** Unique record id. */
  readonly id: string;
  /** The indexed field values this record was stored with. */
  readonly fields: Readonly<Record<string, string>>;
  /** The stored value (parse it yourself). */
  readonly payload: string | null;
  /** ISO 8601 expiry, or null if it never expires. */
  readonly expireAt: string | null;
  /** ISO 8601 creation time. */
  readonly createdAt: string;
}

/** Handle returned by getCollection(name) for reading/writing records. */
interface CollectionHandle {
  /**
   * Append a record. Field keys must be in the collection's indexed fields.
   * @param fields Indexed field values (strings/numbers/booleans).
   * @param payload The value to store.
   * @param options Optional per-write TTL override (expireAt ISO or ttlSeconds); else the collection default applies. A record is no longer found once its life is over.
   */
  store(
    fields: Record<string, string | number | boolean>,
    payload: string,
    options?: { expireAt?: string; ttlSeconds?: number },
  ): Promise<CollectionRecord>;
  /**
   * Query records. "match" is equality on indexed fields; "filter" adds
   * per-field equality (scalar) or IN (array); "latest" returns only the newest.
   * An expired record does not match, so "latest" returns the newest that lives on.
   */
  find(
    match: Record<string, string | number | boolean>,
    options?: {
      filter?: Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>>;
      latest?: boolean;
      limit?: number;
      order?: 'asc' | 'desc';
    },
  ): Promise<CollectionRecord[]>;
  /**
   * Change one record by id. Only the keys given change: "fields" replaces the
   * whole field set, "expireAt" null means never expire. An update does not renew
   * a record's life: only "expireAt" does.
   * @returns The updated record, or null if it no longer exists, or has expired and "expireAt" is not given.
   */
  update(
    id: string,
    changes: { fields?: Record<string, string | number | boolean>; payload?: string; expireAt?: string | null },
  ): Promise<CollectionRecord | null>;
  /**
   * Remove one record by id.
   * @returns true, or false if it was already gone.
   */
  delete(id: string): Promise<boolean>;
}

/**
 * Access a durable, keyed record store shared across channels. Records are
 * append-only; newest-wins is a query result. Reads/writes hit the database.
 * @param name The collection name (defined under Collections in the admin UI).
 */
declare function getCollection(name: string): CollectionHandle;

/**
 * Load a configured resource's content by name.
 * @param name The resource name (defined under Resources in the admin UI).
 * @returns The resource content, or null if no resource has that name.
 */
declare function getResource(name: string): Promise<string | null>;

/** The result of an httpFetch call. */
interface HttpFetchResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Perform an outbound HTTP request. Requests to private/loopback address ranges
 * are blocked (SSRF protection).
 */
declare function httpFetch(
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number },
): Promise<HttpFetchResult>;

/**
 * Route a raw message into another deployed, started channel by name. Guarded
 * against routing loops by a hop-depth cap.
 */
declare function routeMessage(channelName: string, rawData: string): Promise<{
  success: boolean;
  /** The id the target channel gave the message. */
  messageId?: number;
  /** True when the target channel's source filter rejected the message. */
  filtered?: boolean;
  response?: string;
}>;

/**
 * Run a parameterized query against a named Data Source (defined under Data
 * Sources in the admin UI). Data sources are read-only unless configured
 * otherwise. Never string-interpolate values into sql — use params ($1, $2, …).
 * @param dataSourceName The data source name.
 * @param sql Parameterized SQL.
 * @param params Positional query parameters.
 */
declare function dbQuery(
  dataSourceName: string,
  sql: string,
  params?: readonly unknown[],
): Promise<readonly Record<string, unknown>[]>;
`;

const MESSAGE_TYPES: Readonly<Record<string, { readonly type: string; readonly doc: string }>> = {
  HL7V2: { type: 'Hl7MessageProxy', doc: 'The HL7 v2 message as a path proxy: msg.get("PID.3.1").' },
  X12: { type: 'X12MessageProxy', doc: 'The X12 message as a path proxy: msg.get("NM1[3].9").' },
  // Parsed JSON and parsed XML can be any shape the sender chose.
  JSON: { type: 'any', doc: 'The message parsed from JSON.' },
  XML: { type: 'any', doc: 'The message parsed from XML into objects (attributes prefixed with @_).' },
  DELIMITED: { type: 'Array<Record<string, string>>', doc: 'The message as rows, one object per row keyed by column.' },
};

/** Every other data type reaches scripts as plain text. */
const TEXT_MESSAGE = { type: 'string', doc: 'The message text.' } as const;

const DESTINATION_SET = `
/** Choose which destinations receive this message. Names or metadata ids (numbers). */
interface DestinationSet {
  /** Send to no destination. */
  removeAll(): void;
  /** Stop sending to these destinations. */
  remove(destinations: string | number | ReadonlyArray<string | number>): void;
  /** Send only to these destinations. */
  removeAllExcept(destinations: string | number | ReadonlyArray<string | number>): void;
  /** Send to these destinations again after removing them. */
  add(destinations: string | number | ReadonlyArray<string | number>): void;
  /** Whether the message is still going to this destination. */
  contains(destination: string | number): boolean;
  /** The destinations the message is still going to. */
  getConnectorNames(): string[];
}
/** The destinations this message will go to. Source filter and transformer only. */
declare var destinationSet: DestinationSet;
`;

export interface ScriptSurface {
  /**
   * The channel data type the script receives (HL7V2, JSON, ...), which decides
   * the type of msg and tmp. Omit for scripts with no message (deploy, undeploy).
   */
  readonly dataType?: string | undefined;
  /**
   * False for scripts that run without a message (deploy, undeploy): msg, tmp
   * and rawData are not declared, since the engine passes them empty.
   */
  readonly message?: boolean | undefined;
  /** True for source filters and transformers, which can choose destinations. */
  readonly destinationSet?: boolean | undefined;
  /**
   * True for a JavaScript destination's script, which the engine also gives the
   * channel's id and name and the connector message it is sending.
   */
  readonly connectorMessage?: boolean | undefined;
  /** A CODE_TEMPLATE_CONTEXT; omit for a script that sees no templates. */
  readonly templateContext?: string | undefined;
}

/** A stable key for a surface, so callers can skip re-registering the same one. */
export function scriptSurfaceKey(surface: ScriptSurface): string {
  return `${surface.message === false ? 'nomsg' : surface.dataType ?? '-'}|${surface.destinationSet === true ? 'ds' : '-'}|${surface.connectorMessage === true ? 'cm' : '-'}|${surface.templateContext ?? '-'}`;
}

export interface TemplateSource {
  readonly code: string;
  readonly type: string;
  readonly contexts: readonly string[];
}

/**
 * Must select templates as the engine's template-injector does. Load the result
 * as a `.d.ts` file: scripts then see the functions as globals (a declaration
 * file is never a module), and errors inside templates stay out of the
 * script's report (a template is checked when it is saved).
 */
export function templateDeclarations(templates: readonly TemplateSource[], surface: ScriptSurface): string {
  if (surface.templateContext === undefined) return '';
  const context = surface.templateContext;
  return templates
    .filter((t) => t.type === 'FUNCTION' && t.contexts.includes(context))
    .map((t) => t.code.replace(/(@param [A-Za-z_$][\w$]*) - /g, '$1 '))
    .join('\n');
}

/** The engine gives these to deploy, undeploy and JavaScript connector scripts. */
const CHANNEL_IDENTITY = `
/** The id of the channel this script runs for. */
declare var channelId: string;
/** The name of the channel this script runs for. */
declare var channelName: string;
`;

/** Mirrors the engine's ConnectorMessage. */
const CONNECTOR_MESSAGE = `${CHANNEL_IDENTITY}
/** The message this destination is sending. */
interface ConnectorMessage {
  readonly channelId: string;
  readonly messageId: number;
  /** The destination's metadata id (1 for the first destination). */
  readonly metaDataId: number;
  /** The message as this destination sends it, after its transformer. */
  readonly content: string;
  readonly dataType: string;
  readonly correlationId?: string;
  /** What scripts put in the message's maps, as this destination saw them. */
  readonly variables?: Readonly<Record<string, unknown>>;
}
/** The message this destination is sending. */
declare var connectorMessage: ConnectorMessage;
`;

export function scriptDeclarations(surface: ScriptSurface): string {
  if (surface.message === false) return SANDBOX_BASE + CHANNEL_IDENTITY;
  const message = surface.dataType === undefined
    // Global scripts get msg parsed with each channel's own data type. `unknown`
    // made even msg.get('MSH.9') an error, and type errors refuse the save.
    ? { type: 'any', doc: 'Parsed with the data type of the channel the script runs for (an HL7 proxy, X12 proxy, rows, text...): check which before relying on it.' }
    : MESSAGE_TYPES[surface.dataType] ?? TEXT_MESSAGE;
  const messageVars = `
/** Original inbound raw data. */
declare var rawData: string;
/** ${message.doc} */
declare var msg: ${message.type};
/** The outbound message being built. ${message.doc} */
declare var tmp: ${message.type};
`;
  return SANDBOX_BASE + messageVars
    + (surface.destinationSet === true ? DESTINATION_SET : '')
    + (surface.connectorMessage === true ? CONNECTOR_MESSAGE : '');
}
