// A hundred bytes can decompress to maxBodyBytes, so what a receiver spends on its
// compressed bodies is limited across requests (D-334).

import { brotliDecompress, gunzip, inflate, type CompressCallback, type ZlibOptions } from 'node:zlib';
import { RefusedBodyError, tooLarge } from './refused-body.js';

const MAX_RUNNING = 2;

/** Times maxBodyBytes, over the requests not answered yet. */
const MAX_HELD = 4;

/** Node's 16 KiB makes a 50 MB body several times slower. A small body holds one chunk until it is decoded. */
const CHUNK_SIZE = 128 * 1024;

type Decompress = (bytes: Buffer, options: ZlibOptions, callback: CompressCallback) => void;

export interface ContentCoding {
  readonly name: string;
  readonly decompress: Decompress;
}

export interface DecompressedBody {
  readonly bytes: Buffer;
  /** Call once, when the request has been answered. */
  readonly release: () => void;
}

const DECOMPRESSORS: ReadonlyMap<string, Decompress> = new Map<string, Decompress>([
  ['gzip', gunzip],
  ['x-gzip', gunzip],
  ['deflate', inflate],
  ['br', brotliDecompress],
]);

/** Undefined for a body that is not compressed. Two codings are one unknown name here, so they are refused. */
export function contentCoding(header: string | undefined): ContentCoding | undefined {
  const name = (header ?? '').trim().toLowerCase();
  if (name === '' || name === 'identity') return undefined;
  const decompress = DECOMPRESSORS.get(name);
  if (!decompress) throw new RefusedBodyError(415, `Unsupported Content-Encoding: ${name}`, { 'Accept-Encoding': 'gzip, deflate, br' });
  return { name, decompress };
}

export class Decompressor {
  private readonly maxBodyBytes: number;
  private readonly waiting: (() => void)[] = [];
  private running = 0;
  /** The decompressed bytes of unanswered requests, and the limits of the ones being decompressed. */
  private held = 0;

  constructor(maxBodyBytes: number) {
    this.maxBodyBytes = maxBodyBytes;
  }

  /** `isGone`: the sender left while the body waited its turn, so nothing is spent on it. */
  async run(coding: ContentCoding, bytes: Buffer, isGone: () => boolean): Promise<DecompressedBody> {
    await this.turn();
    try {
      if (isGone()) throw new RefusedBodyError(503, 'The connection closed before the body was decompressed');
      return await this.withinLimit(coding, bytes);
    } finally {
      this.endTurn();
    }
  }

  private async turn(): Promise<void> {
    if (this.running < MAX_RUNNING) {
      this.running += 1;
      return;
    }
    await new Promise<void>((resolve) => { this.waiting.push(resolve); });
  }

  private endTurn(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running -= 1;
  }

  private async withinLimit(coding: ContentCoding, bytes: Buffer): Promise<DecompressedBody> {
    const limit = Math.min(this.maxBodyBytes, MAX_HELD * this.maxBodyBytes - this.held);
    if (limit < 1) throw busy();
    this.held += limit;
    try {
      const decompressed = await decompress(coding, bytes, limit);
      // Not read off the buffer in `release`, which would keep it until the answer, beside its text.
      const size = decompressed.length;
      this.held -= limit - size;
      return { bytes: decompressed, release: () => { this.held -= size; } };
    } catch (err) {
      this.held -= limit;
      throw limit < this.maxBodyBytes && err instanceof RefusedBodyError && err.status === 413 ? busy() : err;
    }
  }
}

function busy(): RefusedBodyError {
  return new RefusedBodyError(503, 'Too many compressed bodies are being processed', { 'Retry-After': '1' });
}

/**
 * Every byte must belong to the compressed data: past the end of a deflate or brotli
 * stream Node reports no error and drops what follows.
 */
function decompress(coding: ContentCoding, bytes: Buffer, maxOutputLength: number): Promise<Buffer> {
  const invalid = (): RefusedBodyError => new RefusedBodyError(400, `Request body is not valid ${coding.name}`);
  return new Promise((resolve, reject) => {
    coding.decompress(bytes, { maxOutputLength, chunkSize: CHUNK_SIZE, info: true }, (err, result) => {
      if (err) {
        reject((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE' ? tooLarge() : invalid());
        return;
      }
      // What `info` makes of the result, which Node's types leave out.
      const { buffer, engine } = result as unknown as { readonly buffer: Buffer; readonly engine: { readonly bytesWritten: number } };
      if (engine.bytesWritten === bytes.length) resolve(buffer);
      else reject(invalid());
    });
  });
}
