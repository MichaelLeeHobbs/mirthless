// ===========================================
// Sandbox Globals — Ambient Types for Channel Scripts
// ===========================================
// The canonical type surface a filter / transformer / connector script sees when
// it runs inside the engine sandbox (packages/engine/src/sandbox/). Author TS
// channel scripts against these globals to get real type-checking and editor
// completion.
//
// This file lives at the package root (NOT under src/) on purpose: including it
// in the engine's own tsconfig would leak `msg`, `logger`, etc. into the engine
// source as globals. It is consumed only by script-authoring tooling — a
// tsconfig that lists it, or the Monaco editor. The web admin ships an identical
// surface as a string (packages/web/src/lib/sandbox-types.ts) for Monaco; keep
// the two in sync when the sandbox API changes.

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

/** Logger for sandbox scripts. */
interface SandboxLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

// ----- Global Variables -----

/** Current message being processed. Type depends on inbound data type. */
declare var msg: unknown;
/** Temporary working map. Persists across pipeline stages within a single message. */
declare var tmp: Record<string, unknown>;
/** Original inbound raw data string. */
declare var rawData: string;
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
declare function routeMessage(channelName: string, rawData: string): Promise<{ success: boolean; response?: string }>;

/** Run a parameterized query against a named Data Source. Use params ($1, $2, …). */
declare function dbQuery(
  dataSourceName: string,
  sql: string,
  params?: readonly unknown[],
): Promise<readonly Record<string, unknown>[]>;
