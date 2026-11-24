// A body the source cannot keep whole is refused, never stored changed: the
// sender is told, and still has the message (D-334).

import type { IncomingMessage } from 'node:http';
import { TextDecoder } from 'node:util';
import type { QueueCharset } from '@galvanigraph/core-models';
import { decodePayload } from '../encoding.js';
import { contentCoding, type Decompressor } from './decompression.js';
import { RefusedBodyError, tooLarge } from './refused-body.js';

export interface RequestBodyConfig {
  readonly maxBodyBytes: number;
  readonly bodyCharset: QueueCharset;
}

export interface RequestBody {
  readonly text: string;
  /** Call once, when the request has been answered. */
  readonly release: () => void;
}

type BodyDecoder = (bytes: Buffer) => string;

/**
 * The whole body is read before any of it is judged: an answer sent with bytes unread
 * reaches the sender as a reset connection, or leaves a kept-alive one stuck on them.
 */
export async function readRequestBody(req: IncomingMessage, config: RequestBodyConfig, decompressor: Decompressor): Promise<RequestBody> {
  const received = await readBytes(req, config.maxBodyBytes);
  refuseTransferCoding(req.headers['transfer-encoding']);
  const coding = contentCoding(req.headers['content-encoding']);
  const decode = bodyDecoder(req.headers['content-type'], config.bodyCharset);
  if (!coding) return { text: decode(received), release: () => undefined };
  const { bytes, release } = await decompressor.run(coding, received, () => req.socket.destroyed);
  try {
    return { text: decode(bytes), release };
  } catch (err) {
    release();
    throw err;
  }
}

/** Past the limit the chunks are dropped; the server's request timeout ends a body that never does. */
function readBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) chunks.length = 0;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (size > maxBytes) reject(tooLarge());
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

/** Node undoes chunked and nothing else, so a body with another transfer coding is still encoded. */
function refuseTransferCoding(header: string | undefined): void {
  if (header === undefined || header.trim().toLowerCase() === 'chunked') return;
  throw new RefusedBodyError(501, `Unsupported Transfer-Encoding: ${header}`);
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
