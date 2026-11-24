// A hundred bytes can decompress to maxBodyBytes, so what a receiver spends on its
// compressed bodies is limited across requests (D-334).

import type { Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { createSlots } from '@galvanigraph/core-util';
import { RefusedBodyError, tooLarge } from './refused-body.js';

const MAX_RUNNING = 2;

/** Times maxBodyBytes, over the requests not answered yet. */
const MAX_HELD_BODIES = 4;

/** Under a small maxBodyBytes, four bodies' worth is less than an ordinary busy minute holds. */
const MIN_HELD_LIMIT = 64 * 1024 * 1024;

/** Node's 16 KiB makes a 50 MB body several times slower. */
const CHUNK_SIZE = 128 * 1024;

interface Engine extends Transform {
  /** Compressed bytes the engine has used. */
  readonly bytesWritten: number;
}

export interface ContentCoding {
  readonly name: string;
  readonly createEngine: (options: { readonly chunkSize: number }) => Engine;
}

export interface DecompressedBody {
  readonly bytes: Buffer;
  /** Call once, when the request has been answered. */
  readonly release: () => void;
}

const ENGINES: ReadonlyMap<string, ContentCoding['createEngine']> = new Map<string, ContentCoding['createEngine']>([
  ['gzip', createGunzip],
  ['x-gzip', createGunzip],
  ['deflate', createInflate],
  ['br', createBrotliDecompress],
]);

/** Undefined for a body that is not compressed. Two codings are one unknown name here, so they are refused. */
export function contentCoding(header: string | undefined): ContentCoding | undefined {
  const name = (header ?? '').trim().toLowerCase();
  if (name === '' || name === 'identity') return undefined;
  const createEngine = ENGINES.get(name);
  if (!createEngine) throw new RefusedBodyError(415, `Unsupported Content-Encoding: ${name}`, { 'Accept-Encoding': 'gzip, deflate, br' });
  return { name, createEngine };
}

export class Decompressor {
  private readonly maxBodyBytes: number;
  private readonly maxHeld: number;
  private readonly inTurn = createSlots(MAX_RUNNING);
  /** Decompressed so far by the bodies being decompressed, and by those whose request is not answered. */
  private held = 0;

  constructor(maxBodyBytes: number) {
    this.maxBodyBytes = maxBodyBytes;
    this.maxHeld = Math.max(MAX_HELD_BODIES * maxBodyBytes, MIN_HELD_LIMIT);
  }

  /** `isGone`: the sender left while the body waited its turn, so nothing is spent on it. */
  run(coding: ContentCoding, bytes: Buffer, isGone: () => boolean): Promise<DecompressedBody> {
    return this.inTurn(async () => {
      if (isGone()) throw new RefusedBodyError(503, 'The connection closed before the body was decompressed');
      return this.hold(coding, bytes);
    });
  }

  private async hold(coding: ContentCoding, bytes: Buffer): Promise<DecompressedBody> {
    let size = 0;
    const release = (): void => { this.held -= size; };
    const grow = (by: number): RefusedBodyError | null => {
      size += by;
      this.held += by;
      if (size > this.maxBodyBytes) return tooLarge();
      return this.held > this.maxHeld ? busy() : null;
    };
    try {
      return { bytes: await decompress(coding, bytes, grow), release };
    } catch (err) {
      release();
      throw err;
    }
  }
}

function busy(): RefusedBodyError {
  return new RefusedBodyError(503, 'Too many compressed bodies are being processed', { 'Retry-After': '1' });
}

/**
 * `grow` is told of each piece, and stops the rest by refusing it. Every byte given must
 * belong to the compressed data: past the end of a deflate or brotli stream Node reports no
 * error and drops what follows.
 */
function decompress(coding: ContentCoding, bytes: Buffer, grow: (by: number) => RefusedBodyError | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const engine = coding.createEngine({ chunkSize: CHUNK_SIZE });
    const invalid = (): void => { reject(new RefusedBodyError(400, `Request body is not valid ${coding.name}`)); };
    const pieces: Buffer[] = [];
    const take = (piece: Buffer): void => {
      const refusal = grow(piece.length);
      if (refusal === null) {
        pieces.push(piece);
        return;
      }
      engine.off('data', take);
      engine.destroy();
      reject(refusal);
    };
    engine.on('data', take);
    engine.on('error', invalid);
    engine.on('end', () => {
      if (engine.bytesWritten === bytes.length) resolve(Buffer.concat(pieces));
      else invalid();
    });
    engine.end(bytes);
  });
}
