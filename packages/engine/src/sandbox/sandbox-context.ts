export interface LogEntry {
  readonly level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  readonly message: string;
  readonly timestamp: Date;
}

export interface SandboxLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface SandboxContext {
  readonly msg: unknown;
  readonly tmp: unknown;
  readonly rawData: string;
  /** Set by the source connector. */
  readonly sourceMap: Readonly<Record<string, unknown>>;
  /** Shared across all connectors of the message. */
  readonly channelMap: Record<string, unknown>;
  /** Per destination. */
  readonly connectorMap: Record<string, unknown>;
  /** Read by the postprocessor. */
  readonly responseMap: Record<string, unknown>;
  /** Persists across messages within a deployment. */
  readonly globalChannelMap?: Readonly<Record<string, unknown>> | undefined;
  /** Persists across all channels; flushed to the DB. */
  readonly globalMap?: Record<string, unknown> | undefined;
  /** Loaded from the DB at deploy. */
  readonly configMap?: Readonly<Record<string, unknown>> | undefined;
  readonly extras?: Readonly<Record<string, unknown>> | undefined;
}

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
