// A body the source cannot keep whole is refused, never stored changed: the
// sender is told, and still has the message (D-334).

import type { IncomingMessage } from 'node:http';
import type { QueueCharset } from '@galvanigraph/core-models';
import { declaredCharset, decodePayload, strictDecoder } from '../encoding.js';
import { contentCoding, type Decompressor } from './decompression.js';
import { RefusedBodyError, stoppingStillArriving, tooLarge, tooLargeStillArriving } from './refused-body.js';

export interface RequestBodyConfig {
  readonly maxBodyBytes: number;
  readonly bodyCharset: QueueCharset;
}

export interface BodyOnTheWay {
  readonly req: IncomingMessage;
  /** Aborted to give up on a body that has not arrived. */
  readonly arrivalEnded: AbortSignal;
}

export interface RequestBody {
  readonly text: string;
  /** Call once, when the request has been answered. */
  readonly release: () => void;
}

type BodyDecoder = (bytes: Buffer) => string;

/** How long a body may go on arriving once it is over the limit. Node's own request timeout is five minutes. */
const DRAIN_MS = 10_000;

/**
 * The whole body is read before any of it is judged: an answer sent with bytes unread
 * reaches the sender as a reset connection, or leaves a kept-alive one stuck on them.
 */
export async function readRequestBody(body: BodyOnTheWay, config: RequestBodyConfig, decompressor: Decompressor): Promise<RequestBody> {
  const { req } = body;
  const received = await readBytes(body, config.maxBodyBytes);
  refuseTransferCoding(req.headers['transfer-encoding']);
  // Nothing to decode: a GET may name a coding it has no body for.
  if (received.length === 0) return { text: '', release: () => undefined };
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

/** Past the limit the chunks are dropped, and the rest of the body is read for at most {@link DRAIN_MS}. */
function readBytes({ req, arrivalEnded }: BodyOnTheWay, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let givenUp = false;
    let drain: ReturnType<typeof setTimeout> | undefined;
    const giveUp = (): void => {
      givenUp = true;
      stopWaiting();
      reject(size > maxBytes ? tooLargeStillArriving() : stoppingStillArriving());
    };
    const stopWaiting = (): void => {
      clearTimeout(drain);
      arrivalEnded.removeEventListener('abort', giveUp);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (givenUp) return;
      if (size <= maxBytes) {
        chunks.push(chunk);
        return;
      }
      chunks.length = 0;
      drain ??= setTimeout(giveUp, DRAIN_MS);
    });
    req.on('end', () => {
      stopWaiting();
      if (size > maxBytes) reject(tooLarge());
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      stopWaiting();
      reject(err);
    });
    if (arrivalEnded.aborted) giveUp();
    else arrivalEnded.addEventListener('abort', giveUp);
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
  const declared = bodyCharset === 'base64' ? undefined : declaredCharset(contentType);
  if (declared === undefined) {
    return (bytes) => {
      const decoded = decodePayload(bytes, bodyCharset);
      if (decoded.replaced) throw invalidText(bodyCharset);
      return decoded.text;
    };
  }
  const decoder = strictDecoder(declared, true);
  if (decoder === null) throw new RefusedBodyError(415, `Unsupported character set in Content-Type: ${contentType ?? ''}`);
  return (bytes) => {
    try {
      return decoder.decode(bytes);
    } catch {
      throw invalidText(decoder.encoding);
    }
  };
}

function invalidText(charset: string): RefusedBodyError {
  return new RefusedBodyError(415, `Request body is not valid ${charset}. Declare the character set it is in (charset in Content-Type), or set bodyCharset on the HTTP source: the character set of a body that declares none, or base64 to keep binary bodies.`);
}
