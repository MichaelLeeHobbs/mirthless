/**
 * Windows-1252 characters for bytes 0x80 to 0x9F. The five bytes it leaves
 * undefined (0x81, 0x8D, 0x8F, 0x90, 0x9D) keep their C1 code points, as the
 * WHATWG Encoding Standard decodes them.
 */
const CHARS_80_9F: readonly number[] = [
  0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
  0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
];

const CHARS: readonly number[] = Array.from({ length: 256 }, (_, byte) => CHARS_80_9F[byte - 0x80] ?? byte);

/** A call takes only so many arguments. */
const CHUNK_BYTES = 8192;

/**
 * Not `new TextDecoder('windows-1252')`: Node 22.20 and 24.13 decode it as
 * Latin-1 without an error, and a Node without full ICU does not have it (D-350).
 */
export function decodeWindows1252(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chars = new Uint16Array(Math.min(CHUNK_BYTES, bytes.length));
  for (let start = 0; start < bytes.length; start += CHUNK_BYTES) {
    const chunk = bytes.subarray(start, start + CHUNK_BYTES);
    // A loop and no spread: a callback per byte, or a spread of a typed array, blocks the server for seconds on a large body.
    for (let i = 0; i < chunk.length; i++) chars[i] = CHARS[chunk[i] ?? 0] ?? 0;
    chunks.push(Reflect.apply(String.fromCharCode, null, chars.subarray(0, chunk.length)));
  }
  return chunks.join('');
}
