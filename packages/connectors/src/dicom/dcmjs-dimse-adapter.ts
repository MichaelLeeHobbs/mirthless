// ===========================================
// dcmjs-dimse SCP for the DICOM connector
// ===========================================
// Pure-JS DICOM DIMSE backing for the DICOM source (SCP / C-STORE receive), replacing the
// native @ubercode/dcmtk wrapper. The destination's side is dimse-sender.ts.
//
// The critical piece the native wrapper lacked is association negotiation: an SCP
// must inspect the requested presentation contexts and ACCEPT the ones whose
// abstract syntax (SOP class) and a transfer syntax it supports, otherwise the
// association is rejected ("Source: Service User"). The accept-list here mirrors
// what production DIMSE services commonly accept.

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Result } from '@galvanigraph/core-util';
import pkg from 'dcmjs-dimse';
import { resolveWithinRoots, type FileRoots } from '../file/file-roots.js';
import type { DcmtkReceiver, DcmtkFileData, DcmtkAssociationData } from './dicom-receiver.js';
import { makeDirectory, syncDirectory, syncFile } from './durable-file.js';

const { Server, Scp, Dataset, constants, responses, log } = pkg;
const { SopClass, StorageClass, TransferSyntax, PresentationContextResult, Status } = constants;
const { CEchoResponse, CStoreResponse } = responses;

// Quiets the library's per-association INFO chatter; the connector logs failures itself.
log.setLevel('warn');

type AssociationType = InstanceType<typeof pkg.association.Association>;
type CStoreRequestType = InstanceType<typeof pkg.requests.CStoreRequest>;
type CStoreResponseType = InstanceType<typeof pkg.responses.CStoreResponse>;
type CEchoRequestType = InstanceType<typeof pkg.requests.CEchoRequest>;
type CEchoResponseType = InstanceType<typeof pkg.responses.CEchoResponse>;
type DatasetType = InstanceType<typeof pkg.Dataset>;
type ServerType = InstanceType<typeof pkg.Server>;

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}
function fail<T>(error: Error): Result<T> {
  return { ok: false, value: null, error } as unknown as Result<T>;
}

// An SCP must accept each requested presentation context whose SOP class and a transfer
// syntax it supports, or the peer sees the association rejected ("Source: Service User").
const ACCEPTED_TRANSFER_SYNTAXES: ReadonlySet<string> = new Set<string>([
  TransferSyntax.ImplicitVRLittleEndian,
  TransferSyntax.ExplicitVRLittleEndian,
  TransferSyntax.ExplicitVRBigEndian,
  TransferSyntax.DeflatedExplicitVRLittleEndian,
  TransferSyntax.RleLossless,
  TransferSyntax.JpegBaseline,
  TransferSyntax.JpegLossless,
  TransferSyntax.JpegLsLossless,
  TransferSyntax.JpegLsLossy,
  TransferSyntax.Jpeg2000Lossless,
  TransferSyntax.Jpeg2000Lossy,
]);

// Every storage SOP class rather than a modality list, since the connector only stores.
const ACCEPTED_ABSTRACT_SYNTAXES: ReadonlySet<string> = new Set<string>([
  SopClass.Verification,
  ...Object.values(StorageClass) as string[],
]);

function negotiatePresentationContexts(association: AssociationType): void {
  const contexts = association.getPresentationContexts();
  for (const { id } of contexts) {
    const context = association.getPresentationContext(id);
    const abstractSyntax = context.getAbstractSyntaxUid();
    if (!ACCEPTED_ABSTRACT_SYNTAXES.has(abstractSyntax)) {
      context.setResult(PresentationContextResult.RejectAbstractSyntaxNotSupported);
      continue;
    }
    let accepted = false;
    for (const ts of context.getTransferSyntaxUids()) {
      if (ACCEPTED_TRANSFER_SYNTAXES.has(ts)) {
        context.setResult(PresentationContextResult.Accept, ts);
        accepted = true;
        break;
      }
    }
    if (!accepted) {
      context.setResult(PresentationContextResult.RejectTransferSyntaxesNotSupported);
    }
  }
}

interface ReceiverOptions {
  readonly port: number;
  readonly storageDir: string;
  readonly aeTitle: string;
  readonly connectionTimeoutMs: number;
  readonly roots: FileRoots;
}

/** A DICOM UID (PS3.5 9.1): digits and dots, at most 64 characters. Nothing in it can leave a directory. */
const DICOM_UID = /^[0-9]+(\.[0-9]+)*$/;
const MAX_UID_LENGTH = 64;

/**
 * The SOP Instance UID that names a received file. The sending AE supplies
 * it, so anything but a DICOM UID is refused (#313). One that is missing gets
 * a generated UID, as before.
 */
function instanceUid(value: unknown): string {
  if (value === undefined || value === '') return Dataset.generateDerivedUid();
  if (typeof value === 'string' && value.length <= MAX_UID_LENGTH && DICOM_UID.test(value)) return value;
  throw new Error('The SOP Instance UID is not a DICOM UID (digits and dots, at most 64 characters); the instance was not stored');
}

/** Write a dataset as a DICOM P10 file. */
function writeDataset(dataset: DatasetType, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    dataset.toFile(filePath, (error) => { if (error) reject(error); else resolve(); });
  });
}

/** What the source map of a message from this SCP names as its source. */
export const DIMSE_SOURCE = 'dcmjs-dimse';

/** Copies of one instance that may wait in the storage directory at once. */
const MAX_COPIES = 100;

/**
 * Claim a file name for an instance: `<uid>.dcm`, or `<uid>_<n>.dcm` while an
 * earlier copy is still there. A file now waits until every destination,
 * queued ones included, has sent it (D-325), so a modality that re-sends an
 * instance must not overwrite the copy an earlier message still needs. The
 * name is created exclusively, so two associations cannot claim the same one.
 */
async function claimFileName(dir: string, uid: string): Promise<string> {
  for (let n = 1; n <= MAX_COPIES; n++) {
    const filePath = path.join(dir, n === 1 ? `${uid}.dcm` : `${uid}_${String(n)}.dcm`);
    try {
      await (await fs.open(filePath, 'wx')).close();
      return filePath;
    } catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'EEXIST')) throw err;
    }
  }
  throw new Error(`${String(MAX_COPIES)} copies of this instance are already waiting in the storage directory; the instance was not stored`);
}

class DimseReceiver implements DcmtkReceiver {
  private server: ServerType | null = null;
  private fileListener: ((data: DcmtkFileData) => Promise<void>) | null = null;
  private assocListener: ((data: DcmtkAssociationData) => void) | null = null;
  private errorListener: ((data: { readonly error: Error }) => void) | null = null;

  constructor(private readonly options: ReceiverOptions) {}

  onFileReceived(listener: (data: DcmtkFileData) => Promise<void>): void { this.fileListener = listener; }
  onAssociationComplete(listener: (data: DcmtkAssociationData) => void): void { this.assocListener = listener; }
  onEvent(_event: 'error', listener: (data: { readonly error: Error }) => void): void { this.errorListener = listener; }

  /**
   * Persist a received dataset to a .dcm file and hand it to the listener. Once this resolves the
   * file is on disk and the listener has taken it, so the sender can be told it is stored. The storage directory is checked
   * against the roots before every write, so one swapped for a link out of them since deploy is
   * refused.
   */
  private async handleInstance(dataset: DatasetType, callingAe: string, calledAe: string, assocId: string, files: string[]): Promise<void> {
    const elements = dataset.getElements() as Record<string, unknown>;
    const sopInstanceUid = instanceUid(elements['SOPInstanceUID']);
    const dir = await resolveWithinRoots(this.options.storageDir, this.options.roots);
    await makeDirectory(dir);
    const filePath = await claimFileName(dir, sopInstanceUid);
    try {
      await writeDataset(dataset, filePath);
      await syncFile(filePath);
      await syncDirectory(dir);
    } catch (err) {
      await fs.rm(filePath, { force: true });
      throw err;
    }
    await this.fileListener?.({
      filePath,
      associationId: assocId,
      associationDir: this.options.storageDir,
      callingAE: callingAe,
      calledAE: calledAe,
      source: DIMSE_SOURCE,
      instance: { dataset: elements },
    });
    files.push(filePath);
  }

  async start(): Promise<Result<void>> {
    const storageDir = this.options.storageDir;
    const handleInstance = this.handleInstance.bind(this);
    const emitAssociation = (data: DcmtkAssociationData): void => { this.assocListener?.(data); };
    const emitError = (error: Error): void => { this.errorListener?.({ error }); };

    class ConnectorScp extends Scp {
      private callingAe = '';
      private calledAe = '';
      private readonly assocId = `assoc-${randomUUID()}`;
      private readonly files: string[] = [];
      private readonly storing = new Set<Promise<void>>();
      private readonly startedAt = Date.now();
      private ended = false;

      constructor(...args: ConstructorParameters<typeof Scp>) {
        super(...args);
        this.on('close', () => { this.end(false); });
      }

      /** The association has ended, whether its sender released it, aborted it or hung up: what it stored is complete. */
      private end(released: boolean): void {
        if (this.ended) return;
        this.ended = true;
        void Promise.allSettled(this.storing).then(() => {
          emitAssociation({
            associationId: this.assocId,
            associationDir: storageDir,
            callingAE: this.callingAe,
            calledAE: this.calledAe,
            source: DIMSE_SOURCE,
            files: [...this.files],
            durationMs: Date.now() - this.startedAt,
            released,
          });
        });
      }

      /** The library closes the socket, which ends the association. */
      override abort(): void { /* nothing else to do */ }

      override associationRequested(association: AssociationType): void {
        this.callingAe = association.getCallingAeTitle();
        this.calledAe = association.getCalledAeTitle();
        negotiatePresentationContexts(association);
        this.sendAssociationAccept();
      }

      override associationReleaseRequested(): void {
        this.end(true);
        this.sendAssociationReleaseResponse();
      }

      override cEchoRequest(request: CEchoRequestType, callback: (response: CEchoResponseType) => void): void {
        const response = CEchoResponse.fromRequest(request);
        response.setStatus(Status.Success);
        callback(response);
      }

      override cStoreRequest(request: CStoreRequestType, callback: (response: CStoreResponseType) => void): void {
        const response = CStoreResponse.fromRequest(request);
        const dataset = request.getDataset();
        if (!dataset) {
          response.setStatus(Status.ProcessingFailure);
          callback(response);
          return;
        }
        // The SCU waits for the response, so it learns whether the file was stored.
        const stored = handleInstance(dataset, this.callingAe, this.calledAe, this.assocId, this.files).then(
          () => { response.setStatus(Status.Success); },
          (err: unknown) => {
            emitError(err instanceof Error ? err : new Error(String(err)));
            response.setStatus(Status.ProcessingFailure);
          },
        ).finally(() => {
          callback(response);
          this.storing.delete(stored);
        });
        this.storing.add(stored);
      }
    }

    try {
      const server = new Server(ConnectorScp as unknown as typeof Scp);
      server.on('networkError', (e: Error) => { this.errorListener?.({ error: e }); });
      server.listen(this.options.port, {
        connectTimeout: this.options.connectionTimeoutMs,
        associationTimeout: this.options.connectionTimeoutMs,
        pduTimeout: this.options.connectionTimeoutMs,
      });
      this.server = server;
      return ok(undefined);
    } catch (err) {
      return fail(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async stop(): Promise<void> {
    this.server?.close();
    this.server = null;
  }
}

export function createDimseReceiver(options: {
  readonly port: number;
  readonly storageDir: string;
  readonly aeTitle: string;
  readonly connectionTimeoutMs: number;
  readonly roots: FileRoots;
}): Result<DcmtkReceiver> {
  return ok(new DimseReceiver({
    port: options.port,
    storageDir: options.storageDir,
    aeTitle: options.aeTitle,
    connectionTimeoutMs: options.connectionTimeoutMs,
    roots: options.roots,
  }));
}
