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

/** Logger for sandbox scripts. */
declare var logger: SandboxLogger;

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
`;
