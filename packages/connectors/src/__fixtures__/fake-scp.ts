import type { Writable } from 'node:stream';
import pkg from 'dcmjs-dimse';
import { freePort } from './free-port.js';

const { Server, Scp, Dataset, constants, responses } = pkg;
const { PresentationContextResult, AbortSource, AbortReason } = constants;
const { CStoreResponse } = responses;

type AssociationType = InstanceType<typeof pkg.association.Association>;
type PresentationContextType = InstanceType<typeof pkg.association.PresentationContext>;
type CStoreRequestType = InstanceType<typeof pkg.requests.CStoreRequest>;

export type ScpBehaviour =
  | { readonly answer: number }
  | { readonly answers: readonly number[] }
  | { readonly answerThenHang: number }
  | { readonly answerThenAbort: number }
  | 'reject-association'
  | 'reject-contexts'
  | 'abort'
  | 'close'
  | 'never-answer';

export interface FakeScp {
  readonly port: number;
  /** C-STORE requests that reached it. */
  readonly stores: () => number;
  /** What came, byte for byte. */
  readonly received: { readonly transferSyntax: string; readonly dataset: Buffer }[];
  behaviour: ScpBehaviour;
  close(): void;
}

/**
 * A DICOM archive that refuses, aborts or hangs up as told, over a real association. Of a context's
 * transfer syntaxes it takes the first of `accepts`, or without it, the first proposed.
 */
export async function startFakeScp(behaviour: ScpBehaviour, accepts: readonly string[] | null = null): Promise<FakeScp> {
  const port = await freePort();
  let stores = 0;

  class Archive extends Scp {
    override associationRequested(association: AssociationType): void {
      if (fake.behaviour === 'reject-association') {
        this.sendAssociationReject();
        return;
      }
      for (const { id } of association.getPresentationContexts()) {
        const context = association.getPresentationContext(id);
        const proposed = context.getTransferSyntaxUids();
        const transferSyntax = accepts === null ? proposed[0] : accepts.find((uid) => proposed.includes(uid));
        if (fake.behaviour === 'reject-contexts' || transferSyntax === undefined) {
          context.setResult(PresentationContextResult.RejectAbstractSyntaxNotSupported);
        } else {
          context.setResult(PresentationContextResult.Accept, transferSyntax);
        }
      }
      this.sendAssociationAccept();
    }

    override associationReleaseRequested(): void {
      if (typeof fake.behaviour === 'object' && 'answerThenHang' in fake.behaviour) return;
      this.sendAssociationReleaseResponse();
    }

    override createDatasetFromStoreWritableStream(
      stream: Writable & { toBuffer?(): Buffer },
      context: PresentationContextType,
      callback: (dataset: InstanceType<typeof Dataset>) => void,
    ): void {
      const transferSyntax = context.getAcceptedTransferSyntaxUid() ?? '';
      fake.received.push({ transferSyntax, dataset: stream.toBuffer?.() ?? Buffer.alloc(0) });
      callback(new Dataset({}, transferSyntax));
    }

    override cStoreRequest(request: CStoreRequestType): void {
      stores += 1;
      const { behaviour: does } = fake;
      if (does === 'abort') {
        this.sendAbort(AbortSource.ServiceUser, AbortReason.NotSpecified);
        return;
      }
      if (does === 'close') {
        this.close();
        return;
      }
      if (typeof does !== 'object') return;
      for (const status of 'answers' in does ? does.answers : Object.values(does)) {
        const response = CStoreResponse.fromRequest(request);
        response.setStatus(status);
        // Not the callback: the library takes one answer through it.
        this.sendResponse(request, response);
      }
      if ('answerThenAbort' in does) this.sendAbort(AbortSource.ServiceUser, AbortReason.NotSpecified);
    }
  }

  const server = new Server(Archive as unknown as typeof Scp);
  const fake: FakeScp = { port, stores: () => stores, received: [], behaviour, close: () => { server.close(); } };
  // Once it listens, an error is an association that a test broke on purpose.
  const listening = new Promise<void>((resolve, reject) => {
    server.on('listening', () => { resolve(); });
    server.on('networkError', reject);
  });
  server.listen(port, { connectTimeout: 10_000, associationTimeout: 10_000, pduTimeout: 10_000 });
  await listening;
  return fake;
}
