// Ambient types for authoring scripts in your own editor. The JSDoc here shows
// in script authors' hover and completion.
//
// At the package root, not under src/, on purpose: in the engine's own tsconfig
// it would leak `msg`, `logger` and the rest into engine source as globals.
// core-models' scripting/sandbox-declarations.ts declares the same surface; keep
// the two in sync (sandbox-types-consistency.test.ts checks the names).

/** HL7 message proxy returned by parseHL7(). Path-based access to HL7 fields. */
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

/** Logger for sandbox scripts. Any value is logged as text (String(value)). */
interface SandboxLogger {
  info(message: unknown): void;
  warn(message: unknown): void;
  error(message: unknown): void;
  debug(message: unknown): void;
}

/** Current message being processed. Type depends on inbound data type. */
declare var msg: unknown;
/** The outbound message being built. Type depends on the data type. */
declare var tmp: unknown;
/** Destinations this message goes to. Source filter and transformer only. */
declare var destinationSet: {
  removeAll(): void;
  remove(destinations: string | number | ReadonlyArray<string | number>): void;
  removeAllExcept(destinations: string | number | ReadonlyArray<string | number>): void;
  add(destinations: string | number | ReadonlyArray<string | number>): void;
  contains(destination: string | number): boolean;
  getConnectorNames(): string[];
};
/** Original inbound raw data string. Empty in deploy and undeploy scripts. */
declare var rawData: string;
/** The channel's id. Deploy, undeploy and JavaScript connector scripts only. */
declare var channelId: string;
/** The channel's name. Deploy, undeploy and JavaScript connector scripts only. */
declare var channelName: string;
/** The message a JavaScript destination is sending. JavaScript destination scripts only. */
declare var connectorMessage: {
  readonly channelId: string;
  readonly messageId: number;
  readonly metaDataId: number;
  readonly content: string;
  readonly dataType: string;
  readonly correlationId?: string;
  readonly variables?: Readonly<Record<string, unknown>>;
};
/** Source system metadata. Propagates through the pipeline. */
declare var sourceMap: Record<string, unknown>;
/** Channel-scoped persistent state. Cleared on channel redeploy. */
declare var channelMap: Record<string, unknown>;
/** Connector-scoped state. Lifetime of the connector instance. */
declare var connectorMap: Record<string, unknown>;
/** Response data from destination sends. */
declare var responseMap: Record<string, unknown>;
/** Per-channel map that persists across messages within a deployment. */
declare var globalChannelMap: Record<string, unknown>;
/** Global map (persistent, shared across all channels). */
declare var globalMap: Record<string, unknown>;
/** Configuration map (read-only, frozen). Access via "category.key" format. */
declare var configMap: Readonly<Record<string, unknown>>;
/** Logger for sandbox scripts. */
declare var logger: SandboxLogger;

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

/** Parse an HL7v2 message string into a proxy object. */
declare function parseHL7(raw: string): Hl7MessageProxy;

/** Create an HL7 ACK message from the original raw message. */
declare function createACK(originalRaw: string, ackCode: string, textMessage?: string): string;

/** A record stored in / returned from a collection. */
interface CollectionRecord {
  readonly id: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly payload: string | null;
  readonly expireAt: string | null;
  readonly createdAt: string;
}

/** Handle returned by getCollection(name) for reading/writing records. */
interface CollectionHandle {
  store(
    fields: Record<string, string | number | boolean>,
    payload: string,
    options?: { expireAt?: string; ttlSeconds?: number },
  ): Promise<CollectionRecord>;
  find(
    match: Record<string, string | number | boolean>,
    options?: {
      filter?: Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>>;
      latest?: boolean;
      limit?: number;
      order?: 'asc' | 'desc';
    },
  ): Promise<CollectionRecord[]>;
  /** Null when it no longer exists, or has expired and "expireAt" is not null or later than now. */
  update(
    id: string,
    changes: { fields?: Record<string, string | number | boolean>; payload?: string; expireAt?: string | null },
  ): Promise<CollectionRecord | null>;
  /** False when it was already gone. */
  delete(id: string): Promise<boolean>;
}

/** Access a durable, keyed record store shared across channels. */
declare function getCollection(name: string): CollectionHandle;

/** Load a configured resource's content by name (or null if none). */
declare function getResource(name: string): Promise<string | null>;

/** The result of an httpFetch call. */
interface HttpFetchResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Perform an outbound HTTP request (private/loopback ranges blocked for SSRF). */
declare function httpFetch(
  url: string,
  options?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number },
): Promise<HttpFetchResult>;

/** Route a raw message into another deployed, started channel by name. */
declare function routeMessage(channelName: string, rawData: string): Promise<{
  success: boolean;
  /** The id the target channel gave the message. */
  messageId?: number;
  /** True when the target channel's source filter rejected the message. */
  filtered?: boolean;
  response?: string;
}>;

/** Run a parameterized query against a named Data Source. Use params ($1, $2, …). */
declare function dbQuery(
  dataSourceName: string,
  sql: string,
  params?: readonly unknown[],
): Promise<readonly Record<string, unknown>[]>;
