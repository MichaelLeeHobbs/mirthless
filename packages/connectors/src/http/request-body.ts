// A body the source cannot keep whole is refused, never stored changed: the
// sender is told, and still has the message (D-334).

import type { IncomingMessage } from 'node:http';
import { TextDecoder } from 'node:util';
import { brotliDecompress, gunzip, inflate, type CompressCallback, type ZlibOptions } from 'node:zlib';
import type { QueueCharset } from '@galvanigraph/core-models';
import { decodePayload } from '../encoding.js';

export interface RequestBodyConfig {
  readonly maxBodyBytes: number;
  readonly bodyCharset: QueueCharset;
}

/** The message goes to the sender and to the log, so it holds nothing of the body. */
export class RefusedBodyError extends Error {
  constructor(
    readonly status: 400 | 413 | 415,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }
}

type Decompress = (bytes: Buffer, options: ZlibOptions, callback: CompressCallback) => void;
type BodyDecoder = (bytes: Buffer) => string;

interface ContentCoding {
  readonly name: string;
  readonly decompress: Decompress;
}

const DECOMPRESSORS: ReadonlyMap<string, Decompress> = new Map<string, Decompress>([
  ['gzip', gunzip],
  ['x-gzip', gunzip],
  ['deflate', inflate],
  ['br', brotliDecompress],
]);

export async function readRequestBody(req: IncomingMessage, config: RequestBodyConfig): Promise<string> {
  const coding = contentCoding(req.headers['content-encoding']);
  const decode = bodyDecoder(req.headers['content-type'], config.bodyCharset);
  const received = await readBytes(req, config.maxBodyBytes);
  return decode(coding ? await decompressed(coding, received, config.maxBodyBytes) : received);
}

/** Undefined for a body that is not compressed. Two codings are one unknown name here, so they are refused. */
function contentCoding(header: string | undefined): ContentCoding | undefined {
  const name = (header ?? '').trim().toLowerCase();
  if (name === '' || name === 'identity') return undefined;
  const decompress = DECOMPRESSORS.get(name);
  if (!decompress) throw new RefusedBodyError(415, `Unsupported Content-Encoding: ${name}`, { 'Accept-Encoding': 'gzip, deflate, br' });
  return { name, decompress };
}

/**
 * A charset declared in Content-Type wins over `bodyCharset`, except over `base64`.
 * An unknown one is refused: decoding in the wrong charset corrupts every
 * non-ASCII character without any error. A byte order mark is kept.
 */
function bodyDecoder(contentType: string | undefined, bodyCharset: QueueCharset): BodyDecoder {
  const declared = bodyCharset === 'base64' ? undefined : /;\s*charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType ?? '')?.[1];
  if (declared === undefined) {
    return (bytes) => {
      const decoded = decodePayload(bytes, bodyCharset);
      if (decoded.replaced) throw invalidText(bodyCharset);
      return decoded.text;
    };
  }
  const decoder = strictDecoder(declared);
  if (decoder === null) throw new RefusedBodyError(415, `Unsupported character set in Content-Type: ${contentType ?? ''}`);
  return (bytes) => {
    try {
      return decoder.decode(bytes);
    } catch {
      throw invalidText(decoder.encoding);
    }
  };
}

function strictDecoder(charset: string): TextDecoder | null {
  try {
    return new TextDecoder(charset, { fatal: true, ignoreBOM: true });
  } catch {
    return null;
  }
}

function invalidText(charset: string): RefusedBodyError {
  return new RefusedBodyError(415, `Request body is not valid ${charset}. Declare the character set it is in (charset in Content-Type), or set bodyCharset on the HTTP source: the character set of a body that declares none, or base64 to keep binary bodies.`);
}

function tooLarge(): RefusedBodyError {
  return new RefusedBodyError(413, 'Payload Too Large');
}

function readBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBytes) {
        rejected = true;
        // Stop reading but do not destroy the socket: the caller still needs
        // to flush a 413 response back to the sender.
        req.pause();
        reject(tooLarge());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/**
 * Every byte must belong to the compressed data: past the end of a deflate or brotli
 * stream Node reports no error and drops what follows.
 */
function decompressed(coding: ContentCoding, bytes: Buffer, maxOutputLength: number): Promise<Buffer> {
  const invalid = (): RefusedBodyError => new RefusedBodyError(400, `Request body is not valid ${coding.name}`);
  return new Promise((resolve, reject) => {
    coding.decompress(bytes, { maxOutputLength, info: true }, (err, result) => {
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
