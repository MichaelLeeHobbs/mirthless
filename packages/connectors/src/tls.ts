// ===========================================
// TLS Configuration Types
// ===========================================
// Shared, minimal TLS option shapes for network connectors.
// PHI must be able to travel encrypted; these carry PEM material and
// verification settings. Verification defaults to ON — never silently
// disable certificate checks.

import { isPlainObject } from '@galvanigraph/core-util';

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

/**
 * The `tls` bag from a connector's raw properties: undefined when TLS is not
 * configured (absent, null or false). Throws for any other non-object value,
 * so a malformed setting fails the deploy instead of meaning "plaintext".
 */
function readTlsBag(props: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const tls = props['tls'];
  if (tls === undefined || tls === null || tls === false) return undefined;
  if (!isPlainObject(tls)) throw new Error('TLS configuration is invalid: tls must be an object with cert and key');
  return tls;
}

/** A PEM field from the tls bag: undefined when unset or empty, throws when not a string. */
function readPem(tls: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const value = tls[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`TLS configuration is invalid: tls.${field} must be a PEM string`);
  return value;
}

/**
 * Fail when exactly one of cert and key is set. Half a key pair never means
 * "TLS off": a listener would fall back to plaintext and a client would drop
 * its certificate, so the connector refuses to build and the deploy fails.
 * Messages name the missing field only, never the PEM material.
 */
function assertKeyPair(cert: string | undefined, key: string | undefined): void {
  if (cert !== undefined && key === undefined) {
    throw new Error('TLS configuration is incomplete: tls.cert is set but tls.key (the private key) is missing');
  }
  if (key !== undefined && cert === undefined) {
    throw new Error('TLS configuration is incomplete: tls.key is set but tls.cert (the certificate) is missing');
  }
}

/**
 * Read TLS server options from a connector's raw property bag.
 * Returns undefined only when TLS is not configured: `tls` absent, null or
 * false. Any other `tls` value must carry both cert and key, or this throws:
 * a listener never falls back to plaintext. (The HTTP source factory skips
 * its id-based bag on scheme HTTP before calling this.)
 */
export function readTlsServerOptions(
  props: Readonly<Record<string, unknown>>,
): TlsServerOptions | undefined {
  const tls = readTlsBag(props);
  if (!tls) return undefined;
  const cert = readPem(tls, 'cert');
  const key = readPem(tls, 'key');
  assertKeyPair(cert, key);
  if (cert === undefined || key === undefined) {
    throw new Error('TLS configuration is incomplete: a tls object is set but tls.cert and tls.key are missing');
  }
  return { cert, key, ca: readPem(tls, 'ca'), requireClientCert: tls['requireClientCert'] as boolean | undefined };
}

/**
 * Read TLS client options from a connector's raw property bag.
 * Returns undefined when TLS is not configured. A client certificate is
 * optional, but one without its key (or a key without its certificate) throws.
 */
export function readTlsClientOptions(
  props: Readonly<Record<string, unknown>>,
): TlsClientOptions | undefined {
  const tls = readTlsBag(props);
  if (!tls) return undefined;
  const cert = readPem(tls, 'cert');
  const key = readPem(tls, 'key');
  assertKeyPair(cert, key);
  return { cert, key, ca: readPem(tls, 'ca'), rejectUnauthorized: tls['rejectUnauthorized'] as boolean | undefined };
}
