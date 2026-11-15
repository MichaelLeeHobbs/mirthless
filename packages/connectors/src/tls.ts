// ===========================================
// TLS Configuration Types
// ===========================================
// Shared, minimal TLS option shapes for network connectors.
// PHI must be able to travel encrypted; these carry PEM material and
// verification settings. Verification defaults to ON — never silently
// disable certificate checks.

import { isPlainObject } from '@galvaniflow/core-util';

/** TLS options for a server (receiver) that terminates TLS. */
export interface TlsServerOptions {
  /** Server certificate chain in PEM format. */
  readonly cert: string;
  /** Server private key in PEM format. */
  readonly key: string;
  /** Optional CA bundle (PEM) used to verify client certificates. */
  readonly ca?: string | undefined;
  /** Require and verify a client certificate (mutual TLS). Default false. */
  readonly requireClientCert?: boolean | undefined;
}

/** TLS options for a client (dispatcher) connecting to a TLS server. */
export interface TlsClientOptions {
  /** Optional client certificate (PEM) for mutual TLS. */
  readonly cert?: string | undefined;
  /** Optional client private key (PEM) for mutual TLS. */
  readonly key?: string | undefined;
  /** Optional CA bundle (PEM) used to verify the server certificate. */
  readonly ca?: string | undefined;
  /**
   * Verify the server certificate against trusted CAs.
   * DEFAULTS TO TRUE — set false only for explicit, audited exceptions.
   */
  readonly rejectUnauthorized?: boolean | undefined;
}

/** Error text for a stored `tls` value that is present but not a plain object. */
export const TLS_NOT_AN_OBJECT = 'Connector tls settings must be an object';

/**
 * The stored `tls` bag: undefined when absent (undefined, null or false).
 * Throws for any other value that is not a plain object, so a malformed bag
 * fails the deploy instead of quietly reading as "no TLS".
 */
function readTlsObject(props: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const tls = props['tls'];
  if (tls === undefined || tls === null || tls === false) return undefined;
  if (!isPlainObject(tls)) throw new Error(TLS_NOT_AN_OBJECT);
  return tls;
}

/**
 * Read TLS server options from a connector's raw property bag.
 * Returns undefined when no TLS material is configured.
 * @throws Error when `tls` is present but not an object.
 */
export function readTlsServerOptions(
  props: Readonly<Record<string, unknown>>,
): TlsServerOptions | undefined {
  const tls = readTlsObject(props);
  if (!tls) return undefined;
  const cert = tls['cert'] as string | undefined;
  const key = tls['key'] as string | undefined;
  if (!cert || !key) return undefined;
  return {
    cert,
    key,
    ca: tls['ca'] as string | undefined,
    requireClientCert: tls['requireClientCert'] as boolean | undefined,
  };
}

/**
 * Read TLS client options from a connector's raw property bag.
 * Returns undefined when TLS is not enabled; any object, even `{}`, enables it.
 * @throws Error when `tls` is present but not an object.
 */
export function readTlsClientOptions(
  props: Readonly<Record<string, unknown>>,
): TlsClientOptions | undefined {
  const tls = readTlsObject(props);
  if (!tls) return undefined;
  return {
    cert: tls['cert'] as string | undefined,
    key: tls['key'] as string | undefined,
    ca: tls['ca'] as string | undefined,
    rejectUnauthorized: tls['rejectUnauthorized'] as boolean | undefined,
  };
}
