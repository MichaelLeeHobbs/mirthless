import { inflateRawSync } from 'node:zlib';

// The bytes of a DICOM file (PS3.10): its file meta information and its dataset, which is kept as
// it is. The library's own reader and writer rewrite a dataset and leave out what they do not know
// (private attributes), so nothing on its way through goes by them (#410, D-354).

const PREAMBLE_BYTES = 128;
const MAGIC = 'DICM';
const META_GROUP = 0x0002;
const TRANSFER_SYNTAX = 0x0010;
const DEFLATED = '1.2.840.10008.1.2.1.99';

/** PS3.5 7.1.2: these value representations have a four-byte length after two reserved bytes. */
const LONG_VRS: ReadonlySet<string> = new Set(['OB', 'OD', 'OF', 'OL', 'OV', 'OW', 'SQ', 'SV', 'UC', 'UN', 'UR', 'UT', 'UV']);

export interface DicomFile {
  readonly transferSyntax: string;
  /** The dataset as its transfer syntax encodes it: what a C-STORE sends. */
  readonly dataset: Buffer;
}

interface ElementHeader {
  readonly group: number;
  readonly element: number;
  readonly vr: string;
  readonly length: number;
  /** Where the value starts. */
  readonly start: number;
}

/** One element's header in explicit VR little endian. */
function explicitHeader(bytes: Buffer, at: number): ElementHeader {
  const group = bytes.readUInt16LE(at);
  const element = bytes.readUInt16LE(at + 2);
  // Items and delimiters have no value representation.
  if (group === 0xfffe) return { group, element, vr: '', length: bytes.readUInt32LE(at + 4), start: at + 8 };
  const vr = bytes.toString('latin1', at + 4, at + 6);
  if (LONG_VRS.has(vr)) return { group, element, vr, length: bytes.readUInt32LE(at + 8), start: at + 12 };
  return { group, element, vr, length: bytes.readUInt16LE(at + 6), start: at + 8 };
}

function text(bytes: Buffer): string {
  return bytes.toString('latin1').replace(/[\0 ]+$/, '');
}

/** Far more than a dataset worth deflating; what a hostile one may grow to. */
const MAX_INFLATED_BYTES = 256 * 1024 * 1024;

/** The dataset as a reader of its elements needs it: one transfer syntax deflates the whole of it. */
export function readableDataset(dataset: Buffer, transferSyntax: string): Buffer {
  return transferSyntax === DEFLATED ? inflateRawSync(dataset, { maxOutputLength: MAX_INFLATED_BYTES }) : dataset;
}

/** Read a DICOM file, or throw when it is not one. */
export function readDicomFile(file: Buffer): DicomFile {
  if (file.length < PREAMBLE_BYTES + 4 || file.toString('latin1', PREAMBLE_BYTES, PREAMBLE_BYTES + 4) !== MAGIC) {
    throw new Error('Not a DICOM file: no DICM after the preamble');
  }
  let transferSyntax = '';
  let at = PREAMBLE_BYTES + 4;
  while (at + 8 <= file.length && file.readUInt16LE(at) === META_GROUP) {
    const header = explicitHeader(file, at);
    const end = header.start + header.length;
    if (end > file.length) throw new Error('Not a DICOM file: its file meta information is cut short');
    if (header.element === TRANSFER_SYNTAX) transferSyntax = text(file.subarray(header.start, end));
    at = end;
  }
  if (transferSyntax === '') throw new Error('Not a DICOM file: its file meta information names no transfer syntax');
  return { transferSyntax, dataset: file.subarray(at) };
}

function metaElement(element: number, vr: string, value: Buffer): Buffer {
  const long = LONG_VRS.has(vr);
  const header = Buffer.alloc(long ? 12 : 8);
  header.writeUInt16LE(META_GROUP, 0);
  header.writeUInt16LE(element, 2);
  header.write(vr, 4, 'latin1');
  if (long) header.writeUInt32LE(value.length, 8);
  else header.writeUInt16LE(value.length, 6);
  return Buffer.concat([header, value]);
}

/** Values have an even length (PS3.5 6.2): a UID is padded with a null, text with a space. */
function padded(value: string, pad: string): Buffer {
  return Buffer.from(value.length % 2 === 0 ? value : value + pad, 'latin1');
}

/** The bytes before the dataset: preamble, magic and file meta information. */
export function fileHeader(meta: {
  readonly sopClass: string;
  readonly sopInstance: string;
  readonly transferSyntax: string;
  readonly implementationClass: string;
  readonly implementationVersion: string;
}): Buffer {
  const elements = Buffer.concat([
    metaElement(0x0001, 'OB', Buffer.from([0, 1])),
    metaElement(0x0002, 'UI', padded(meta.sopClass, '\0')),
    metaElement(0x0003, 'UI', padded(meta.sopInstance, '\0')),
    metaElement(TRANSFER_SYNTAX, 'UI', padded(meta.transferSyntax, '\0')),
    metaElement(0x0012, 'UI', padded(meta.implementationClass, '\0')),
    metaElement(0x0013, 'SH', padded(meta.implementationVersion, ' ')),
  ]);
  const groupLength = Buffer.alloc(4);
  groupLength.writeUInt32LE(elements.length);
  return Buffer.concat([Buffer.alloc(PREAMBLE_BYTES), Buffer.from(MAGIC, 'latin1'), metaElement(0x0000, 'UL', groupLength), elements]);
}

const ITEM_GROUP = 0xfffe;
const ITEM = 0xe000;
const ITEM_END = 0xe00d;
const SEQUENCE_END = 0xe0dd;
const UNDEFINED_LENGTH = 0xffffffff;

function implicitHeader(group: number, element: number, length: number): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(group, 0);
  header.writeUInt16LE(element, 2);
  header.writeUInt32LE(length, 4);
  return header;
}

/**
 * The end of a sequence of undefined length and unknown VR: its content is implicit VR little
 * endian whatever the dataset is (PS3.5 6.2.2).
 */
function endOfUnknownSequence(bytes: Buffer, start: number): number {
  let depth = 1;
  let at = start;
  while (depth > 0) {
    const group = bytes.readUInt16LE(at);
    const element = bytes.readUInt16LE(at + 2);
    const length = bytes.readUInt32LE(at + 4);
    at += 8;
    if (group === ITEM_GROUP && (element === ITEM_END || element === SEQUENCE_END)) depth -= 1;
    else if (length === UNDEFINED_LENGTH) depth += 1;
    else at += length;
  }
  return at;
}

interface Container {
  /** Where one of a defined length ends; Infinity for one that a delimiter ends. */
  readonly end: number;
  readonly delimiter: number;
}

/** A dataset in explicit VR little endian, in implicit VR little endian: the same elements and values. */
export function explicitToImplicit(dataset: Buffer): Buffer {
  const out: Buffer[] = [];
  const open: Container[] = [];
  let at = 0;
  for (;;) {
    // A container's length changes with its headers, so each is ended by a delimiter instead.
    while ((open.at(-1)?.end ?? Infinity) <= at) {
      out.push(implicitHeader(ITEM_GROUP, open.pop()?.delimiter ?? ITEM_END, 0));
    }
    if (at >= dataset.length) break;
    const { group, element, vr, length, start } = explicitHeader(dataset, at);
    const isItem = group === ITEM_GROUP;
    if (isItem && element !== ITEM) {
      open.pop();
      out.push(implicitHeader(group, element, 0));
      at = start;
    } else if (length !== 0 && (isItem || vr === 'SQ')) {
      open.push({ end: length === UNDEFINED_LENGTH ? Infinity : start + length, delimiter: isItem ? ITEM_END : SEQUENCE_END });
      out.push(implicitHeader(group, element, UNDEFINED_LENGTH));
      at = start;
    } else {
      const end = length === UNDEFINED_LENGTH ? unknownEnd(dataset, start, vr) : start + length;
      if (end > dataset.length) throw new Error('The dataset is cut short');
      // A group length counts the bytes of explicit VR headers.
      if (element !== 0x0000) out.push(implicitHeader(group, element, length), dataset.subarray(start, end));
      at = end;
    }
  }
  if (open.length > 0) throw new Error('The dataset is cut short');
  return Buffer.concat(out);
}

function unknownEnd(dataset: Buffer, start: number, vr: string): number {
  if (vr !== 'UN') throw new Error('The pixel data is compressed');
  return endOfUnknownSequence(dataset, start);
}
