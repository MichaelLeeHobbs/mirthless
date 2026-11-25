// ===========================================
// dcmjs-dimse SCP for the DICOM connector
// ===========================================
// Pure-JS DICOM DIMSE backing for the DICOM source (SCP / C-STORE receive), replacing the
// native @ubercode/dcmtk wrapper. The destination's side is dimse-sender.ts.
//
// The critical piece the native wrapper lacked is association negotiation: an SCP
// must inspect the requested presentation contexts and ACCEPT the ones whose
// abstract syntax (SOP class) and a transfer syntax it supports, otherwise the
// association is rejected ("Source: Service User"). It accepts every standard storage SOP class (D-355).

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Writable } from 'node:stream';
import { settleWithin, tryCatch, type Result } from '@galvanigraph/core-util';
import pkg from 'dcmjs-dimse';
import { resolveWithinRoots, type FileRoots } from '../file/file-roots.js';
import type { DcmtkReceiver, DcmtkFileData, DcmtkAssociationData } from './dicom-receiver.js';
import { fileHeader, readableDataset, startsWithFileMeta } from './dicom-file.js';
import { makeDirectory, syncDirectory } from './durable-file.js';

const { Server, Scp, Dataset, Implementation, constants, responses, log } = pkg;
const { AbortReason, AbortSource, SopClass, TransferSyntax, PresentationContextResult, RejectReason, RejectResult, RejectSource, Status } = constants;
const { CEchoResponse, CStoreResponse } = responses;

// Quiets the library's per-association INFO chatter; the connector logs failures itself.
log.setLevel('warn');

type AssociationType = InstanceType<typeof pkg.association.Association>;
type CStoreRequestType = InstanceType<typeof pkg.requests.CStoreRequest>;
type CStoreResponseType = InstanceType<typeof pkg.responses.CStoreResponse>;
type CEchoRequestType = InstanceType<typeof pkg.requests.CEchoRequest>;
type CEchoResponseType = InstanceType<typeof pkg.responses.CEchoResponse>;
type PresentationContextType = InstanceType<typeof pkg.association.PresentationContext>;
type ServerType = InstanceType<typeof pkg.Server>;

function ok<T>(value: T): Result<T> {
  return { ok: true, value, error: null } as Result<T>;
}

/** The root DICOM gives its storage SOP classes (PS3.4 B.5 and I.4), and the ones it put elsewhere (PS3.4 GG). */
const STORAGE_ROOT = '1.2.840.10008.5.1.4.1.1.';
const OTHER_STORAGE: ReadonlySet<string> = new Set([
  '1.2.840.10008.5.1.4.34.7', // RT Beams Delivery Instruction
  '1.2.840.10008.5.1.4.34.10', // RT Brachy Application Setup Delivery Instruction
  '1.2.840.10008.5.1.4.38.1', // Hanging Protocol
  '1.2.840.10008.5.1.4.39.1', // Color Palette
  '1.2.840.10008.5.1.4.43.1', // Generic Implant Template
  '1.2.840.10008.5.1.4.44.1', // Implant Assembly Template
  '1.2.840.10008.5.1.4.45.1', // Implant Template Group
]);

/** Services DICOM put under the storage root: the queries, retrievals and creation of protocol approvals and inventories. */
const NOT_STORAGE: ReadonlySet<string> = new Set(['200.4', '200.5', '200.6', '201.2', '201.3', '201.4', '201.5', '201.6'].map((end) => STORAGE_ROOT + end));

/** Every standard storage SOP class, by its UID and not by a list of names: the connector stores bytes, whatever they are. */
function isAcceptedSopClass(uid: string): boolean {
  if (uid === SopClass.Verification || OTHER_STORAGE.has(uid)) return true;
  return uid.startsWith(STORAGE_ROOT) && !NOT_STORAGE.has(uid);
}

const OTHER_TRANSFER_SYNTAXES: ReadonlySet<string> = new Set<string>([
  TransferSyntax.ImplicitVRLittleEndian,
  TransferSyntax.ExplicitVRLittleEndian,
  TransferSyntax.ExplicitVRBigEndian,
  TransferSyntax.DeflatedExplicitVRLittleEndian,
  TransferSyntax.RleLossless,
  '1.2.840.10008.1.2.1.98', // Encapsulated Uncompressed
  '1.2.840.10008.1.2.8.1', // Deflated Image Frame Compression
]);

/** Where DICOM puts its image and video codecs, and the two (JPIP) whose pixel data is only a URL: stored, there would be no image. */
const CODEC_ROOT = '1.2.840.10008.1.2.4.';
const JPIP: ReadonlySet<string> = new Set(['1.2.840.10008.1.2.4.94', '1.2.840.10008.1.2.4.95', '1.2.840.10008.1.2.4.204', '1.2.840.10008.1.2.4.205']);

function isAcceptedTransferSyntax(uid: string): boolean {
  return OTHER_TRANSFER_SYNTAXES.has(uid) || (uid.startsWith(CODEC_ROOT) && !JPIP.has(uid));
}

function negotiatePresentationContexts(association: AssociationType): void {
  for (const { id } of association.getPresentationContexts()) {
    const context = association.getPresentationContext(id);
    const transferSyntax = context.getTransferSyntaxUids().find(isAcceptedTransferSyntax);
    if (!isAcceptedSopClass(context.getAbstractSyntaxUid())) {
      context.setResult(PresentationContextResult.RejectAbstractSyntaxNotSupported);
    } else if (transferSyntax === undefined) {
      context.setResult(PresentationContextResult.RejectTransferSyntaxesNotSupported);
    } else {
      context.setResult(PresentationContextResult.Accept, transferSyntax);
    }
  }
}

/** An association a stop has to end. */
interface OpenAssociation {
  /** Answer what was taken, then abort. Resolves once the connection is closed. */
  finish(): Promise<void>;
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

/** The SOP Instance UID names the file, and the sending AE supplies it, so anything but a DICOM UID is refused (#313). */
function checkedUid(uid: string): string {
  if (uid.length <= MAX_UID_LENGTH && DICOM_UID.test(uid)) return uid;
  throw new Error('The SOP Instance UID is not a DICOM UID (digits and dots, at most 64 characters); the instance was not stored');
}

/** PS3.4 B.2.3. The library's constants stop at the general statuses. */
const CANNOT_UNDERSTAND = 0xc000;

/** A received dataset: its attributes as the library reads them, for the source map, and the bytes that came, for the file. */
class ReceivedDataset extends Dataset {
  readonly sopClass: string;
  readonly sopInstance: string;

  /** Throws when the bytes do not name the instance: the library reads anything, and what it found none in is not a dataset. */
  constructor(readonly bytes: Buffer, transferSyntax: string) {
    const readable = readableDataset(bytes, transferSyntax);
    // In the file it would be read as more of the header, and change what the file says it is.
    if (startsWithFileMeta(readable)) throw new Error('The dataset starts with file meta information');
    super(readable, transferSyntax);
    const { SOPClassUID, SOPInstanceUID } = this.getElements();
    if (typeof SOPClassUID !== 'string' || typeof SOPInstanceUID !== 'string' || SOPClassUID === '' || SOPInstanceUID === '') {
      throw new Error('The dataset has no SOP Class UID or no SOP Instance UID');
    }
    this.sopClass = SOPClassUID;
    this.sopInstance = SOPInstanceUID;
  }
}

/** What the library collected of a C-STORE. Its types leave the method out. */
function bytesOf(stream: Writable): Buffer {
  if ('toBuffer' in stream && typeof stream.toBuffer === 'function') {
    const bytes: unknown = stream.toBuffer();
    if (Buffer.isBuffer(bytes)) return bytes;
  }
  throw new Error('The received dataset cannot be read back');
}

/** Write an instance as a DICOM file with its dataset as it came. It is on disk once this resolves. */
async function writeInstance(dataset: ReceivedDataset, filePath: string): Promise<void> {
  const header = fileHeader({
    sopClass: dataset.sopClass,
    sopInstance: dataset.sopInstance,
    transferSyntax: dataset.getTransferSyntaxUid(),
    implementationClass: Implementation.getImplementationClassUid(),
    implementationVersion: Implementation.getImplementationVersion(),
  });
  const handle = await fs.open(filePath, 'w');
  try {
    await handle.writeFile(header);
    await handle.writeFile(dataset.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** How long a stop waits for the images already taken to be answered. */
const ANSWERS_END_MS = 5_000;

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
  private stopping = false;
  private readonly associations = new Set<OpenAssociation>();
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
  private async handleInstance(dataset: ReceivedDataset, callingAe: string, calledAe: string, assocId: string, files: string[]): Promise<void> {
    const sopInstanceUid = checkedUid(dataset.sopInstance);
    const dir = await resolveWithinRoots(this.options.storageDir, this.options.roots);
    await makeDirectory(dir);
    const filePath = await claimFileName(dir, sopInstanceUid);
    try {
      await writeInstance(dataset, filePath);
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
      instance: { dataset: dataset.getElements() },
    });
    files.push(filePath);
  }

  async start(): Promise<Result<void>> {
    const storageDir = this.options.storageDir;
    const handleInstance = this.handleInstance.bind(this);
    const emitAssociation = (data: DcmtkAssociationData): void => { this.assocListener?.(data); };
    const emitError = (error: Error): void => { this.errorListener?.({ error }); };
    const associations = this.associations;
    const isStopping = (): boolean => this.stopping;

    class ConnectorScp extends Scp implements OpenAssociation {
      private callingAe = '';
      private calledAe = '';
      private readonly assocId = `assoc-${randomUUID()}`;
      private readonly files: string[] = [];
      private readonly storing = new Set<Promise<void>>();
      private readonly startedAt = Date.now();
      private ended = false;

      constructor(...args: ConstructorParameters<typeof Scp>) {
        super(...args);
        associations.add(this);
        this.on('close', () => {
          associations.delete(this);
          this.end(false);
        });
      }

      async finish(): Promise<void> {
        // Before the wait: a sender that hangs up during it closes the connection itself.
        const closed = new Promise<void>((resolve) => { this.on('close', () => { resolve(); }); });
        await Promise.allSettled(this.storing);
        this.sendAbort(AbortSource.ServiceUser, AbortReason.NotSpecified);
        // Ends the socket once what was written has gone out.
        this.close();
        await closed;
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
        if (isStopping()) {
          this.sendAssociationReject(RejectResult.Transient, RejectSource.ServiceProviderPresentation, RejectReason.TemporaryCongestion);
          return;
        }
        negotiatePresentationContexts(association);
        this.sendAssociationAccept();
      }

      override associationReleaseRequested(): void {
        this.end(true);
        this.sendAssociationReleaseResponse();
      }

      override createDatasetFromStoreWritableStream(
        stream: Writable,
        context: PresentationContextType,
        callback: (dataset: ReceivedDataset) => void,
      ): void {
        let dataset: ReceivedDataset | undefined;
        try {
          dataset = new ReceivedDataset(bytesOf(stream), context.getAcceptedTransferSyntaxUid() ?? '');
        } catch (err) {
          // Answered as not understood; thrown, it would end the association.
          emitError(err instanceof Error ? err : new Error(String(err)));
        }
        callback(dataset as ReceivedDataset);
      }

      override cEchoRequest(request: CEchoRequestType, callback: (response: CEchoResponseType) => void): void {
        const response = CEchoResponse.fromRequest(request);
        response.setStatus(Status.Success);
        callback(response);
      }

      override cStoreRequest(request: CStoreRequestType, callback: (response: CStoreResponseType) => void): void {
        const response = CStoreResponse.fromRequest(request);
        const dataset = request.getDataset();
        // Nothing would make a message of an image sent after the release, or while the listener stops.
        if (!(dataset instanceof ReceivedDataset) || this.ended || isStopping()) {
          response.setStatus(dataset instanceof ReceivedDataset ? Status.ProcessingFailure : CANNOT_UNDERSTAND);
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

    this.stopping = false;
    return this.listen(new Server(ConnectorScp as unknown as typeof Scp));
  }

  /** Ok once the port is open. The library reports a port in use as it does any later network error. */
  private async listen(server: ServerType): Promise<Result<void>> {
    const listening = new Promise<void>((resolve, reject) => {
      server.on('listening', () => { resolve(); });
      server.on('networkError', (error: Error) => {
        reject(error);
        if (this.server === server) this.errorListener?.({ error });
      });
      server.listen(this.options.port, {
        connectTimeout: this.options.connectionTimeoutMs,
        associationTimeout: this.options.connectionTimeoutMs,
        pduTimeout: this.options.connectionTimeoutMs,
      });
    });
    const opened = await tryCatch(listening);
    if (opened.ok) this.server = server;
    return opened;
  }

  async stop(): Promise<void> {
    const { server } = this;
    if (!server) return;
    this.stopping = true;
    // A sender whose image was taken is told so before its association is cut off.
    await settleWithin(Promise.allSettled([...this.associations].map((association) => association.finish())), ANSWERS_END_MS);
    await this.halt();
  }

  async halt(): Promise<void> {
    this.stopping = true;
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
