// ===========================================
// Sandbox TypeScript Definitions
// ===========================================
// Type definitions for Monaco IntelliSense in sandbox script editors.
// Matches the sandbox executor globals from packages/engine/src/sandbox/.

export const SANDBOX_TYPE_DEFS = `
/**
 * HL7 message proxy returned by parseHL7().
 * Provides path-based access to HL7 fields.
 */
interface Hl7MessageProxy {
  /** Get field value by HL7 path (e.g., "MSH.9.1", "PID.3"). */
  get(path: string): string | undefined;
  /** Set field value by HL7 path. */
  set(path: string, value: string): void;
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

/** Sandbox logger with level-based methods. */
interface SandboxLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
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

// ----- Global Variables -----

/** Current message being processed. Type depends on inbound data type. */
declare var msg: unknown;

/** Temporary working map. Persists across pipeline stages within a single message. */
declare var tmp: Record<string, unknown>;

/** Original inbound raw data (string or Buffer). */
declare var rawData: string;

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

// ----- Map Shortcut Aliases -----

/** Alias for channelMap. */
declare var $c: Record<string, unknown>;
/** Alias for responseMap. */
declare var $r: Record<string, unknown>;
/** Alias for globalChannelMap. */
declare var $g: Record<string, unknown>;
/** Alias for globalMap. */
declare var $gc: Record<string, unknown>;

// ----- Global Functions -----

/**
 * Parse an HL7v2 message string into a proxy object.
 * @param raw - Raw HL7 message string (pipe-delimited).
 * @returns Proxy with get/set/delete/toString methods.
 */
declare function parseHL7(raw: string): Hl7MessageProxy;

/**
 * Create an HL7 ACK message from the original raw message.
 * @param originalRaw - The original HL7 message.
 * @param ackCode - ACK code (e.g., "AA", "AE", "AR").
 * @param textMessage - Optional text message for MSA.3.
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
   * @param fields - Indexed field values (strings/numbers/booleans).
   * @param payload - The value to store.
   * @param options - Optional per-write TTL override (expireAt ISO or ttlSeconds); else the collection default applies.
   */
  store(
    fields: Record<string, string | number | boolean>,
    payload: string,
    options?: { expireAt?: string; ttlSeconds?: number },
  ): Promise<CollectionRecord>;
  /**
   * Query records. "match" is equality on indexed fields; "filter" adds
   * per-field equality (scalar) or IN (array); "latest" returns only the newest.
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
}

/**
 * Access a durable, keyed record store shared across channels. Records are
 * append-only; newest-wins is a query result. Reads/writes hit the database.
 * @param name - The collection name (defined under Collections in the admin UI).
 */
declare function getCollection(name: string): CollectionHandle;

/**
 * Load a configured resource's content by name.
 * @param name - The resource name (defined under Resources in the admin UI).
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
declare function routeMessage(channelName: string, rawData: string): Promise<{ success: boolean; response?: string }>;

/**
 * Run a parameterized query against a named Data Source (defined under Data
 * Sources in the admin UI). Data sources are read-only unless configured
 * otherwise. Never string-interpolate values into sql — use params ($1, $2, …).
 * @param dataSourceName - The data source name.
 * @param sql - Parameterized SQL.
 * @param params - Positional query parameters.
 */
declare function dbQuery(
  dataSourceName: string,
  sql: string,
  params?: readonly unknown[],
): Promise<readonly Record<string, unknown>[]>;
`;
