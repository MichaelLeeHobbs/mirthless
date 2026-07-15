// ===========================================
// dcmjs-dimse adapter for the DICOM connector
// ===========================================
// Pure-JS DICOM DIMSE backing for the DICOM source (SCP / C-STORE receive) and
// destination (SCU / C-STORE send), replacing the native @ubercode/dcmtk wrapper.
//
// The critical piece the native wrapper lacked is association negotiation: an SCP
// must inspect the requested presentation contexts and ACCEPT the ones whose
// abstract syntax (SOP class) and a transfer syntax it supports, otherwise the
// association is rejected ("Source: Service User"). The accept-list here mirrors
// the production MedFusion DIMSE service (packages/dicom + apps/dimse).

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Result } from '@mirthless/core-util';
import pkg from 'dcmjs-dimse';
import type { DcmtkReceiver, DcmtkFileData, DcmtkAssociationData } from './dicom-receiver.js';
import type { DcmtkSender, DcmtkSendResult } from './dicom-dispatcher.js';

const { Server, Scp, Client, Dataset, constants, requests, responses, log } = pkg;
const { SopClass, StorageClass, TransferSyntax, PresentationContextResult, Status } = constants;
const { CStoreRequest } = requests;
const { CEchoResponse, CStoreResponse } = responses;

// Silence dcmjs-dimse's per-association protocol chatter (loglevel INFO); the
// connector surfaces failures through its own ConnectorLogger. Warnings/errors
// from the library still pass through.
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

// ----- Accepted presentation contexts -----

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

// All storage SOP classes plus Verification (C-ECHO). The channel connector only
// stores, so we accept everything storable rather than a narrow modality list.
const ACCEPTED_ABSTRACT_SYNTAXES: ReadonlySet<string> = new Set<string>([
  SopClass.Verification,
  ...Object.values(StorageClass) as string[],
]);

/** Negotiate presentation contexts on an inbound association: accept storable SOP classes. */
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

// ----- SCP receiver -----

interface ReceiverOptions {
  readonly port: number;
  readonly storageDir: string;
  readonly aeTitle: string;
  readonly connectionTimeoutMs: number;
}

class DimseReceiver implements DcmtkReceiver {
  private server: ServerType | null = null;
  private fileListener: ((data: DcmtkFileData) => void) | null = null;
  private assocListener: ((data: DcmtkAssociationData) => void) | null = null;
  private errorListener: ((data: { readonly error: Error }) => void) | null = null;

  constructor(private readonly options: ReceiverOptions) {}

  onFileReceived(listener: (data: DcmtkFileData) => void): void { this.fileListener = listener; }
  onAssociationComplete(listener: (data: DcmtkAssociationData) => void): void { this.assocListener = listener; }
  onEvent(_event: 'error', listener: (data: { readonly error: Error }) => void): void { this.errorListener = listener; }

  /** Persist a received dataset to a .dcm file and notify listeners. */
  private handleInstance(dataset: DatasetType, callingAe: string, calledAe: string, assocId: string, files: string[]): void {
    const elements = dataset.getElements() as Record<string, unknown>;
    const sopInstanceUid = typeof elements['SOPInstanceUID'] === 'string' && elements['SOPInstanceUID']
      ? (elements['SOPInstanceUID'] as string)
      : Dataset.generateDerivedUid();
    fs.mkdirSync(this.options.storageDir, { recursive: true });
    const filePath = path.join(this.options.storageDir, `${sopInstanceUid}.dcm`);
    dataset.toFile(filePath);
    files.push(filePath);
    this.fileListener?.({
      filePath,
      associationId: assocId,
      associationDir: this.options.storageDir,
      callingAE: callingAe,
      calledAE: calledAe,
      source: 'dcmjs-dimse',
      instance: { dataset: elements },
    });
  }

  async start(): Promise<Result<void>> {
    // Capture just what the per-connection Scp needs, to avoid aliasing `this`.
    const storageDir = this.options.storageDir;
    const handleInstance = this.handleInstance.bind(this);
    const emitAssociation = (data: DcmtkAssociationData): void => { this.assocListener?.(data); };
    const emitError = (error: Error): void => { this.errorListener?.({ error }); };
    let assocCounter = 0;

    class ConnectorScp extends Scp {
      private callingAe = '';
      private calledAe = '';
      private readonly assocId = `assoc-${String(++assocCounter)}`;
      private readonly files: string[] = [];
      private readonly startedAt = Date.now();

      override associationRequested(association: AssociationType): void {
        this.callingAe = association.getCallingAeTitle();
        this.calledAe = association.getCalledAeTitle();
        negotiatePresentationContexts(association);
        this.sendAssociationAccept();
      }

      override associationReleaseRequested(): void {
        emitAssociation({
          associationId: this.assocId,
          associationDir: storageDir,
          callingAE: this.callingAe,
          calledAE: this.calledAe,
          source: 'dcmjs-dimse',
          files: [...this.files],
          durationMs: Date.now() - this.startedAt,
        });
        this.sendAssociationReleaseResponse();
      }

      override cEchoRequest(request: CEchoRequestType, callback: (response: CEchoResponseType) => void): void {
        const response = CEchoResponse.fromRequest(request);
        response.setStatus(Status.Success);
        callback(response);
      }

      override cStoreRequest(request: CStoreRequestType, callback: (response: CStoreResponseType) => void): void {
        const response = CStoreResponse.fromRequest(request);
        try {
          const dataset = request.getDataset();
          if (!dataset) {
            response.setStatus(Status.ProcessingFailure);
            callback(response);
            return;
          }
          handleInstance(dataset, this.callingAe, this.calledAe, this.assocId, this.files);
          response.setStatus(Status.Success);
        } catch (err) {
          emitError(err instanceof Error ? err : new Error(String(err)));
          response.setStatus(Status.ProcessingFailure);
        }
        callback(response);
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

/** Factory: a dcmjs-dimse-backed DICOM SCP receiver. */
export function createDimseReceiver(options: {
  readonly port: number;
  readonly storageDir: string;
  readonly aeTitle: string;
  readonly minPoolSize: number;
  readonly maxPoolSize: number;
  readonly connectionTimeoutMs: number;
}): Result<DcmtkReceiver> {
  return ok(new DimseReceiver({
    port: options.port,
    storageDir: options.storageDir,
    aeTitle: options.aeTitle,
    connectionTimeoutMs: options.connectionTimeoutMs,
  }));
}

// ----- SCU sender -----

interface SenderOptions {
  readonly host: string;
  readonly port: number;
  readonly calledAETitle: string;
  readonly callingAETitle: string;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
}

class DimseSender implements DcmtkSender {
  constructor(private readonly options: SenderOptions) {}

  private sendOnce(files: readonly string[]): Promise<Result<DcmtkSendResult>> {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const client = new Client();
      for (const file of files) {
        client.addRequest(new CStoreRequest(file));
      }

      let rejection: Error | null = null;
      client.on('associationRejected', (r: { result: number; source: number; reason: number }) => {
        rejection = new Error(`DICOM association rejected: result=${String(r.result)} source=${String(r.source)} reason=${String(r.reason)}`);
      });
      client.on('networkError', (e: Error) => { resolve(fail(e)); });
      client.on('closed', () => {
        if (rejection) { resolve(fail(rejection)); return; }
        resolve(ok({ files, fileCount: files.length, durationMs: Date.now() - startedAt }));
      });

      client.send(this.options.host, this.options.port, this.options.callingAETitle, this.options.calledAETitle, {
        connectTimeout: this.options.timeoutMs,
        associationTimeout: this.options.timeoutMs,
        pduTimeout: this.options.timeoutMs,
      });
    });
  }

  async send(files: readonly string[]): Promise<Result<DcmtkSendResult>> {
    let attempt = 0;
    let last: Result<DcmtkSendResult> = fail(new Error('no attempt made'));
    for (;;) {
      last = await this.sendOnce(files);
      if (last.ok || attempt >= this.options.maxRetries) return last;
      attempt += 1;
      if (this.options.retryDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.options.retryDelayMs));
      }
    }
  }

  async stop(): Promise<void> { /* clients are created per send */ }
}

/** Factory: a dcmjs-dimse-backed DICOM SCU sender. */
export function createDimseSender(options: {
  readonly host: string;
  readonly port: number;
  readonly calledAETitle: string;
  readonly callingAETitle: string;
  readonly mode: 'single' | 'multiple';
  readonly maxAssociations: number;
  readonly maxRetries: number;
  readonly retryDelayMs: number;
  readonly timeoutMs: number;
}): Result<DcmtkSender> {
  return ok(new DimseSender({
    host: options.host,
    port: options.port,
    calledAETitle: options.calledAETitle,
    callingAETitle: options.callingAETitle,
    maxRetries: options.maxRetries,
    retryDelayMs: options.retryDelayMs,
    timeoutMs: options.timeoutMs,
  }));
}
