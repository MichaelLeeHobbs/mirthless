import { tryCatch, type Result } from '@galvanigraph/core-util';
import pkg from 'dcmjs-dimse';
import type { DcmtkSender, DcmtkSendResult } from './dicom-dispatcher.js';

const { Client, constants, requests, log } = pkg;
const { Status } = constants;
const { CStoreRequest } = requests;

// Quiets the library's per-association INFO chatter; the connector reports failures itself.
log.setLevel('warn');

type AssociationType = InstanceType<typeof pkg.association.Association>;
type CStoreRequestType = InstanceType<typeof pkg.requests.CStoreRequest>;
type CStoreResponseType = InstanceType<typeof pkg.responses.CStoreResponse>;

interface SenderOptions {
  readonly host: string;
  readonly port: number;
  readonly calledAETitle: string;
  readonly callingAETitle: string;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
}

/**
 * PS3.4 B.2.3: 0000 and the Bxxx warnings (elements coerced or left out, dataset not matching
 * its SOP class) mean stored. Any other status is taken as not stored, so a status nobody
 * defined is an error rather than a delivery.
 */
function isStored(status: number): boolean {
  return status === Status.Success || isWarning(status);
}

function isWarning(status: number): boolean {
  return (status & 0xf000) === 0xb000;
}

export function statusText(status: number): string {
  return `0x${status.toString(16).toUpperCase().padStart(4, '0')}`;
}

const REFUSALS: ReadonlyMap<number, string> = new Map([
  [0x0110, 'processing failure'],
  [0x0111, 'duplicate SOP instance'],
  [0x0117, 'invalid SOP instance'],
  [0x0122, 'SOP class not supported'],
  [0x0124, 'not authorized'],
  [0x0210, 'duplicate invocation'],
  [0x0211, 'unrecognized operation'],
  [0x0212, 'mistyped argument'],
]);

function refusal(status: number): string {
  const named = REFUSALS.get(status);
  if (named !== undefined) return named;
  if ((status & 0xff00) === 0xa700) return 'out of resources';
  if ((status & 0xff00) === 0xa900) return 'the dataset does not match the SOP class';
  if ((status & 0xf000) === 0xc000) return 'cannot understand the dataset';
  return 'unknown reason';
}

/** What each C-STORE of one association was answered. Without an answer, nothing says the instance was stored. */
class StoreAnswers {
  private readonly answers = new Map<CStoreRequestType, number>();

  constructor(private readonly stores: readonly CStoreRequestType[]) {
    for (const store of stores) {
      store.on('response', (response: CStoreResponseType) => { this.answers.set(store, response.getStatus()); });
    }
  }

  /** Why the files are not delivered, or null when the remote AE said it stored every one. */
  failure(cause: Error): Error | null {
    const statuses = this.stores.map((store) => this.answers.get(store));
    const refused = statuses.find((status) => status !== undefined && !isStored(status));
    if (refused !== undefined) {
      return new Error(`The remote AE answered C-STORE with status ${statusText(refused)} (${refusal(refused)}); the image was not stored`);
    }
    return statuses.includes(undefined) ? cause : null;
  }

  warnings(): number[] {
    return [...this.answers.values()].filter(isWarning);
  }
}

class DimseSender implements DcmtkSender {
  constructor(private readonly options: SenderOptions) {}

  private sendOnce(files: readonly string[]): Promise<DcmtkSendResult> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const client = new Client();
      const stores = files.map((file) => new CStoreRequest(file));
      const answers = new StoreAnswers(stores);
      for (const store of stores) client.addRequest(store);

      // The association's end decides nothing by itself: an archive can answer and then abort,
      // and what it answered as stored must not be sent again.
      let cause = new Error('The connection was closed before the remote AE answered C-STORE');
      const settle = (): void => {
        const failure = answers.failure(cause);
        if (failure !== null) reject(failure);
        else resolve({ files, fileCount: files.length, durationMs: Date.now() - startedAt, warnings: answers.warnings() });
      };
      client.on('associationAccepted', (association: AssociationType) => {
        // The library leaves out a request with no accepted context, and still ends normally.
        const left = stores.find((store) => association.getAcceptedPresentationContextFromRequest(store) === undefined);
        if (left) cause = new Error(`The remote AE accepted no presentation context for SOP class ${left.getAffectedSopClassUid() ?? 'unknown'}; the image was not sent`);
      });
      client.on('associationRejected', (r: { result: number; source: number; reason: number }) => {
        cause = new Error(`DICOM association rejected: result=${String(r.result)} source=${String(r.source)} reason=${String(r.reason)}`);
      });
      client.on('abort', (a: { source: number; reason: number }) => {
        cause = new Error(`The remote AE aborted the association before it answered C-STORE: source=${String(a.source)} reason=${String(a.reason)}`);
      });
      client.on('networkError', (e: Error) => { cause = e; settle(); });
      client.on('closed', settle);

      client.send(this.options.host, this.options.port, this.options.callingAETitle, this.options.calledAETitle, {
        connectTimeout: this.options.timeoutMs,
        associationTimeout: this.options.timeoutMs,
        pduTimeout: this.options.timeoutMs,
      });
    });
  }

  async send(files: readonly string[]): Promise<Result<DcmtkSendResult>> {
    let attempt = 0;
    for (;;) {
      const last = await tryCatch(() => this.sendOnce(files));
      if (last.ok || attempt >= this.options.maxRetries) return last;
      attempt += 1;
      if (this.options.retryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.options.retryDelayMs));
      }
    }
  }

  async stop(): Promise<void> { /* clients are created per send */ }
}

export function createDimseSender(options: SenderOptions): Result<DcmtkSender> {
  return { ok: true, value: new DimseSender(options), error: null };
}
