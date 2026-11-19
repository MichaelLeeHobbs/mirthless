import { isPlainObject } from '@galvanigraph/core-util';

export interface TlsServerOptions {
  readonly cert: string;
  readonly key: string;
  readonly ca?: string | undefined;
  readonly requireClientCert?: boolean | undefined;
}

export interface TlsClientOptions {
  readonly cert?: string | undefined;
  readonly key?: string | undefined;
  readonly ca?: string | undefined;
  /** Undefined means true; set false only for explicit, audited exceptions. */
  readonly rejectUnauthorized?: boolean | undefined;
}

/** Throws on a non-object `tls`, so a malformed setting fails the deploy instead of meaning plaintext. */
function readTlsBag(props: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const tls = props['tls'];
  if (tls === undefined || tls === null || tls === false) return undefined;
  if (!isPlainObject(tls)) throw new Error('TLS configuration is invalid: tls must be an object with cert and key');
  return tls;
}

function readPem(tls: Readonly<Record<string, unknown>>, field: string): string | undefined {
  const value = tls[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`TLS configuration is invalid: tls.${field} must be a PEM string`);
  return value;
}

/**
 * Half a key pair never means "TLS off": a listener would fall back to
 * plaintext and a client would drop its certificate. Messages never carry PEM material.
 */
function assertKeyPair(cert: string | undefined, key: string | undefined): void {
  if (cert !== undefined && key === undefined) {
    throw new Error('TLS configuration is incomplete: tls.cert is set but tls.key (the private key) is missing');
  }
  if (key !== undefined && cert === undefined) {
    throw new Error('TLS configuration is incomplete: tls.key is set but tls.cert (the certificate) is missing');
  }
}

/** A configured `tls` must carry both cert and key: a listener never falls back to plaintext. */
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
