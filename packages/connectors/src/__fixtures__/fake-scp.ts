import pkg from 'dcmjs-dimse';
import { freePort } from './free-port.js';

const { Server, Scp, constants, responses } = pkg;
const { PresentationContextResult, AbortSource, AbortReason, TransferSyntax } = constants;
const { CStoreResponse } = responses;

type AssociationType = InstanceType<typeof pkg.association.Association>;
type CStoreRequestType = InstanceType<typeof pkg.requests.CStoreRequest>;

export type ScpBehaviour =
  | { readonly answer: number }
  | { readonly answers: readonly number[] }
  | { readonly answerThenHang: number }
  | { readonly answerThenAbort: number }
  | 'reject-association'
  | 'reject-contexts'
  | 'uncompressed-only'
  | 'abort'
  | 'close'
  | 'never-answer';

export interface FakeScp {
  readonly port: number;
  /** C-STORE requests that reached it. */
  readonly stores: () => number;
  behaviour: ScpBehaviour;
  close(): void;
}

/** A DICOM archive that refuses, aborts or hangs up as told, over a real association. */
export async function startFakeScp(behaviour: ScpBehaviour): Promise<FakeScp> {
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
        const transferSyntax = context.getTransferSyntaxUids()
          .find((uid) => fake.behaviour !== 'uncompressed-only' || uid === TransferSyntax.ImplicitVRLittleEndian);
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
  const fake: FakeScp = { port, stores: () => stores, behaviour, close: () => { server.close(); } };
  // Once it listens, an error is an association that a test broke on purpose.
  const listening = new Promise<void>((resolve, reject) => {
    server.on('listening', () => { resolve(); });
    server.on('networkError', reject);
  });
  server.listen(port, { connectTimeout: 10_000, associationTimeout: 10_000, pduTimeout: 10_000 });
  await listening;
  return fake;
}
