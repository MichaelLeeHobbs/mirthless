// ===========================================
// Connector TLS Resolver
// ===========================================
// Resolves certificate-ID references in HTTP connector properties into the raw
// PEM material the connectors package consumes. This runs SERVER-SIDE (deploy
// time and connection-test time) because the connectors package has no DB access.
//
// HARD CUT: connector props store cert-ID references only — never inline PEM.
// For scheme === 'HTTPS' the id-based `tls` bag is replaced by a PEM-based bag
// whose keys match exactly what readTlsServerOptions/readTlsClientOptions read.
// FAIL LOUD: any missing/invalid referenced id, or a cert selected for a role
// that needs a private key but has none, returns a Result error so the channel
// never deploys (or a test never passes) silently without the TLS it asked for.

import { tryCatch, type Result } from 'stderr-lib';
import { ServiceError } from '../lib/service-error.js';
import { CertificateService } from './certificate.service.js';

// ----- Helpers -----

/** Load a referenced certificate's PEM material, failing loud when absent. */
async function loadMaterial(
  id: string,
): Promise<{ certificatePem: string; privateKeyPem: string | null }> {
  const result = await CertificateService.getMaterialById(id);
  if (!result.ok) {
    throw new ServiceError('INVALID_INPUT', `Referenced certificate ${id} could not be resolved: ${result.error.message}`);
  }
  return result.value;
}

/** Read the nested id-based tls bag from raw props (may be absent). */
function readTlsBag(props: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const tls = props['tls'];
  return typeof tls === 'object' && tls !== null ? (tls as Record<string, unknown>) : {};
}

/** Read an optional string id from a tls bag. */
function optionalId(bag: Record<string, unknown>, key: string): string | undefined {
  const value = bag[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// ----- Public API -----

/**
 * Resolve an HTTP DESTINATION connector's id-based TLS references to PEM material.
 * Passes props through unchanged when scheme !== 'HTTPS'.
 */
export async function resolveHttpDestinationTls(
  props: Readonly<Record<string, unknown>>,
): Promise<Result<Record<string, unknown>>> {
  return tryCatch(async () => {
    if (props['scheme'] !== 'HTTPS') {
      return { ...props };
    }
    const bag = readTlsBag(props);
    const caCertId = optionalId(bag, 'caCertId');
    const clientCertId = optionalId(bag, 'clientCertId');
    const pemTls: Record<string, unknown> = { rejectUnauthorized: bag['rejectUnauthorized'] !== false };

    if (caCertId) {
      pemTls['ca'] = (await loadMaterial(caCertId)).certificatePem;
    }
    if (clientCertId) {
      const client = await loadMaterial(clientCertId);
      if (!client.privateKeyPem) {
        throw new ServiceError('INVALID_INPUT', `Client certificate ${clientCertId} has no private key; cannot use for mutual TLS`);
      }
      pemTls['cert'] = client.certificatePem;
      pemTls['key'] = client.privateKeyPem;
    }
    return { ...props, tls: pemTls };
  });
}

/**
 * Resolve an HTTP SOURCE connector's id-based TLS references to PEM material.
 * Passes props through unchanged when scheme !== 'HTTPS'. Requires a serverCertId.
 */
export async function resolveHttpSourceTls(
  props: Readonly<Record<string, unknown>>,
): Promise<Result<Record<string, unknown>>> {
  return tryCatch(async () => {
    if (props['scheme'] !== 'HTTPS') {
      return { ...props };
    }
    const bag = readTlsBag(props);
    const serverCertId = optionalId(bag, 'serverCertId');
    if (!serverCertId) {
      throw new ServiceError('INVALID_INPUT', 'HTTPS source connector requires a serverCertId');
    }
    const server = await loadMaterial(serverCertId);
    if (!server.privateKeyPem) {
      throw new ServiceError('INVALID_INPUT', `Server certificate ${serverCertId} has no private key; cannot terminate TLS`);
    }
    const pemTls: Record<string, unknown> = {
      cert: server.certificatePem,
      key: server.privateKeyPem,
      requireClientCert: bag['requireClientCert'] === true,
    };
    const caCertId = optionalId(bag, 'caCertId');
    if (caCertId) {
      pemTls['ca'] = (await loadMaterial(caCertId)).certificatePem;
    }
    return { ...props, tls: pemTls };
  });
}
