// ===========================================
// Sandbox Context
// ===========================================
// Defines the context injected into sandbox scripts.
// Contains message data, maps, and a logger.

// ----- Log Entry -----

export interface LogEntry {
  readonly level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  readonly message: string;
  readonly timestamp: Date;
}

// ----- Sandbox Logger -----

export interface SandboxLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

// ----- Sandbox Context -----

/** Context available to user scripts inside the sandbox. */
export interface SandboxContext {
  /** Parsed inbound message. */
  readonly msg: unknown;
  /** Outbound message being built (mutable by transformer scripts). */
  readonly tmp: unknown;
  /** Original raw content string. */
  readonly rawData: string;
  /** Source-scoped key-value store, set by the source connector. */
  readonly sourceMap: Readonly<Record<string, unknown>>;
  /** Channel-scoped key-value store, shared across all connectors. */
  readonly channelMap: Record<string, unknown>;
  /** Connector-scoped key-value store, per destination. */
  readonly connectorMap: Record<string, unknown>;
  /** Response key-value store, available in postprocessor. */
  readonly responseMap: Record<string, unknown>;
  /** Per-channel map that persists across messages within a deployment. */
  readonly globalChannelMap?: Readonly<Record<string, unknown>> | undefined;
  /** Extra objects to inject into the sandbox (e.g. destinationSet). */
  readonly extras?: Readonly<Record<string, unknown>> | undefined;
}

/** Create a fresh sandbox context with default empty maps. */
export function createSandboxContext(
  msg: unknown,
  rawData: string,
  tmp?: unknown,
): SandboxContext {
  return {
    msg,
    tmp: tmp ?? msg,
    rawData,
    sourceMap: {},
    channelMap: {},
    connectorMap: {},
    responseMap: {},
  };
}
