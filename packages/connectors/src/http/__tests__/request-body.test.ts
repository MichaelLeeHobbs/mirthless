import { describe, it, expect, vi } from 'vitest';
import type * as http from 'node:http';
import type * as util from 'node:util';
import { PassThrough } from 'node:stream';
import { Decompressor } from '../decompression.js';
import { readRequestBody } from '../request-body.js';

/** Node 22.20 and 24.13 decode windows-1252 as Latin-1, with and without `fatal`, and say nothing (#391). */
vi.mock('node:util', async (importOriginal) => {
  const original = await importOriginal<typeof util>();
  class WrongTextDecoder extends original.TextDecoder {
    override decode(...args: Parameters<util.TextDecoder['decode']>): string {
      return this.encoding === 'windows-1252' ? Buffer.from(args[0] as Uint8Array).toString('latin1') : super.decode(...args);
    }
  }
  return { ...original, TextDecoder: WrongTextDecoder };
});

async function readDeclared(charset: string, bytes: Buffer): Promise<string> {
  const sender = Object.assign(new PassThrough(), { headers: { 'content-type': `text/plain; charset=${charset}` } });
  sender.end(bytes);
  const body = await readRequestBody(
    { req: sender as unknown as http.IncomingMessage, arrivalEnded: new AbortController().signal },
    { maxBodyBytes: 1024, bodyCharset: 'utf-8' },
    new Decompressor(1024),
  );
  return body.text;
}

describe('readRequestBody on a Node that decodes windows-1252 as Latin-1', () => {
  // The WHATWG Encoding Standard reads all of these as windows-1252.
  it.each(['windows-1252', 'CP1252', 'ISO-8859-1', 'latin1', 'us-ascii'])('reads a body that declares %s as windows-1252', async (charset) => {
    expect(await readDeclared(charset, Buffer.from([0x93, 0x4d, 0xfc, 0x94, 0x20, 0x80, 0x00]))).toBe('“Mü” €\0');
  });

  it('still refuses a body that is not valid in another charset it declares', async () => {
    await expect(readDeclared('utf-8', Buffer.from([0x93]))).rejects.toMatchObject({ status: 415 });
    expect(await readDeclared('utf-8', Buffer.from('“Mü”'))).toBe('“Mü”');
  });
});
