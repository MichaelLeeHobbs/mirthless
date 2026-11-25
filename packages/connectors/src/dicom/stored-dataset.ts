import * as fs from 'node:fs/promises';
import pkg from 'dcmjs-dimse';
import { explicitToImplicit, readDicomFile, readableDataset } from './dicom-file.js';

const { Dataset, constants } = pkg;
const { TransferSyntax } = constants;

/**
 * A stored file's dataset, for a C-STORE that sends exactly its bytes. The library encodes a dataset
 * it has read, which loses what it does not know and rewrites numbers, so this one is never read.
 */
export class StoredDataset extends Dataset {
  private constructor(private readonly bytes: Buffer, transferSyntax: string, uids: Readonly<Record<string, unknown>>) {
    super(uids, transferSyntax);
  }

  static async ofFile(filePath: string): Promise<StoredDataset> {
    const { dataset, transferSyntax } = readDicomFile(await fs.readFile(filePath));
    const head = new Dataset(readableDataset(dataset, transferSyntax), transferSyntax, { untilTag: '00080018', includeUntilTagValue: true });
    const { SOPClassUID, SOPInstanceUID } = head.getElements();
    if (typeof SOPClassUID !== 'string' || typeof SOPInstanceUID !== 'string' || SOPClassUID === '' || SOPInstanceUID === '') {
      throw new Error('The DICOM file has no SOP Class UID or no SOP Instance UID');
    }
    return new StoredDataset(dataset, transferSyntax, { SOPClassUID, SOPInstanceUID });
  }

  override getDenaturalizedDataset(): Buffer {
    return this.bytes;
  }

  /** What the library transcodes from. There is nothing to transcode, and without this it would send two elements as the image. */
  override getElements(): never {
    throw new Error('A stored image is not transcoded');
  }

  /** The same elements and values for an AE that takes only implicit VR, or null when they cannot be put so. */
  asImplicit(): StoredDataset | null {
    if (this.getTransferSyntaxUid() !== TransferSyntax.ExplicitVRLittleEndian) return null;
    const uids = { SOPClassUID: this.getElement('SOPClassUID'), SOPInstanceUID: this.getElement('SOPInstanceUID') };
    return new StoredDataset(explicitToImplicit(this.bytes), TransferSyntax.ImplicitVRLittleEndian, uids);
  }
}
