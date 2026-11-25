// dcmjs-dimse is a dependency of the connectors package, not of the repository root, so it is loaded from there.

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { INTEGRATION_WAIT_MS } from '../../../packages/server/test/time-budgets.js';

interface DimseClient {
  addRequest(request: unknown): void;
  on(event: 'associationRejected' | 'networkError' | 'closed', listener: (arg: unknown) => void): void;
  send(host: string, port: number, callingAe: string, calledAe: string, options: Readonly<Record<string, number>>): void;
}

interface Dimse {
  readonly Client: new () => DimseClient;
  readonly requests: { readonly CStoreRequest: new (file: string) => unknown };
}

const dimse = createRequire(resolve('packages/connectors/package.json'))('dcmjs-dimse') as Dimse;

export const SAMPLE_DCM = resolve('packages/connectors/src/__tests__/e2e/fixtures/sample.dcm');

export function cStore(port: number, file: string, callingAe: string, calledAe: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const client = new dimse.Client();
    client.addRequest(new dimse.requests.CStoreRequest(file));
    let failure: Error | null = null;
    client.on('associationRejected', () => { failure = new Error(`DICOM association to port ${String(port)} was rejected`); });
    client.on('networkError', (e) => { failure = e instanceof Error ? e : new Error(String(e)); });
    client.on('closed', () => { if (failure) reject(failure); else resolvePromise(); });
    client.send('127.0.0.1', port, callingAe, calledAe, { connectTimeout: INTEGRATION_WAIT_MS, associationTimeout: INTEGRATION_WAIT_MS, pduTimeout: INTEGRATION_WAIT_MS });
  });
}
