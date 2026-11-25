// How many attachments an email has, from its own bytes (#369, D-388). Anyone can send one, and this
// runs while the engine waits: it is linear in the bytes, and gives up on what no real email is made of.

/** A multipart whose parts are being read. */
interface OpenMultipart {
  /** The line before each part. The one after the last has two more hyphens. */
  readonly delimiter: string;
  /** Of a part that names none. */
  readonly partType: string;
}

interface Field {
  /** In lower case. Empty when there is none, or it is none. */
  readonly value: string;
  readonly parameters: ReadonlyMap<string, string>;
}

interface PartHeader {
  readonly contentType: Field;
  readonly disposition: Field;
  readonly bodyAt: number;
}

interface Email {
  readonly source: Buffer;
  /** Outermost first. */
  readonly open: OpenMultipart[];
  /** What may still be read. */
  headerBytes: number;
  delimiterLines: number;
}

export const MAX_PARTS = 1_000;
/** Of all parts together. */
export const MAX_HEADER_BYTES = 1_048_576;
/** Lines that begin as a delimiter does. */
export const MAX_DELIMITER_LINES = 100_000;
/** A multipart nested deeper counts as one attachment. */
const MAX_DEPTH = 20;
/** RFC 5322 allows a line 998 characters. */
const MAX_DELIMITER_LENGTH = 1_000;
const MAX_VALUE_LENGTH = 200;
const LINE_FEED = 0x0a;
const HYPHEN = 0x2d;
const DELIMITER_AHEAD = Buffer.from('\n--');
const CONTENT_TYPE = 'content-type';
const DISPOSITION = 'content-disposition';

function lineEnd(source: Buffer, at: number): number {
  const end = source.indexOf(LINE_FEED, at);
  return end === -1 ? source.length : end;
}

function isBlank(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\r';
}

function trimBlankEnd(line: string): string {
  let end = line.length;
  while (isBlank(line[end - 1])) end -= 1;
  return line.slice(0, end);
}

/** The value of a parameter at `at`, quoted or not, and where it ends. */
function parameterValue(text: string, at: number): { readonly value: string; readonly end: number } {
  if (text[at] !== '"') {
    const semicolon = text.indexOf(';', at);
    const end = semicolon === -1 ? text.length : semicolon;
    return { value: text.slice(at, end).trim(), end };
  }
  let value = '';
  let from = at + 1;
  let i = from;
  for (; i < text.length && text[i] !== '"'; i += 1) {
    if (text[i] === '\\') {
      value += text.slice(from, i);
      i += 1;
      from = i;
    }
  }
  return { value: value + text.slice(from, i), end: i + 1 };
}

/** The first of its name counts. `name*0` and `name*1` are its pieces, and `name*` is in a charset it names first (RFC 2231). */
function addParameter(parameters: Map<string, string>, name: string, value: string): void {
  const [base = '', piece = ''] = name.split('*');
  const text = name.endsWith('*') ? value.replace(/^[^']{0,40}'[^']{0,40}'/, '') : value;
  if (Number(piece) > 0) parameters.set(base, (parameters.get(base) ?? '') + text);
  else if (text !== '' && !parameters.has(base)) parameters.set(base, text);
}

function parseField(text: string): Field {
  const parameters = new Map<string, string>();
  let at = text.indexOf(';');
  // A comment may be within it, and white space around its slash.
  const value = (at === -1 ? text : text.slice(0, at)).slice(0, MAX_VALUE_LENGTH).replace(/\([^)]*\)/g, ' ').trim().toLowerCase();
  while (at !== -1) {
    let equals = at + 1;
    while (equals < text.length && text[equals] !== '=' && text[equals] !== ';') equals += 1;
    if (text[equals] !== '=') {
      at = equals < text.length ? equals : -1;
      continue;
    }
    let start = equals + 1;
    while (isBlank(text[start])) start += 1;
    const parameter = parameterValue(text, start);
    addParameter(parameters, text.slice(at + 1, equals).trim().toLowerCase(), parameter.value);
    at = text.indexOf(';', parameter.end);
  }
  return { value, parameters };
}

function findDelimiter(line: string, open: readonly OpenMultipart[]): { readonly level: number; readonly closes: boolean } | null {
  if (!line.startsWith('--') || line.length > MAX_DELIMITER_LENGTH) return null;
  const text = trimBlankEnd(line);
  for (let level = open.length - 1; level >= 0; level -= 1) {
    const { delimiter } = open[level]!;
    if (text === delimiter) return { level, closes: false };
    if (text.length === delimiter.length + 2 && text === `${delimiter}--`) return { level, closes: true };
  }
  return null;
}

/** Null when there is too much of it. */
function readHeader(email: Email, start: number): PartHeader | null {
  const { source, open } = email;
  const fields = new Map<string, string[]>();
  let current: string[] | undefined;
  let at = start;
  let bodyAt = source.length;
  while (at < source.length) {
    const end = lineEnd(source, at);
    email.headerBytes -= end + 1 - at;
    if (email.headerBytes < 0) return null;
    const line = source.toString('latin1', at, end).replace(/\r$/, '');
    if (line === '') { bodyAt = end + 1; break; }
    if (findDelimiter(line, open) !== null) { bodyAt = at; break; }
    if (line.startsWith(' ') || line.startsWith('\t')) {
      current?.push(line);
    } else {
      const colon = line.indexOf(':');
      const name = line.slice(0, Math.max(colon, 0)).trim().toLowerCase();
      current = undefined;
      if ((name === CONTENT_TYPE || name === DISPOSITION) && !fields.has(name)) {
        current = [line.slice(colon + 1)];
        fields.set(name, current);
      }
    }
    at = end + 1;
  }
  const read = (name: string): Field => parseField(fields.get(name)?.join('') ?? '');
  return { contentType: read(CONTENT_TYPE), disposition: read(DISPOSITION), bodyAt };
}

/** Where the header of the next part starts. Closes the multiparts that end before it. Null when there is too much to look through. */
function nextPart(email: Email, bodyAt: number): number | 'none' | null {
  const { source, open } = email;
  let at = bodyAt;
  while (open.length > 0) {
    if (source[at] !== HYPHEN || source[at + 1] !== HYPHEN) {
      const ahead = source.indexOf(DELIMITER_AHEAD, at);
      if (ahead === -1) return 'none';
      at = ahead + 1;
    }
    email.delimiterLines -= 1;
    if (email.delimiterLines < 0) return null;
    const end = lineEnd(source, at);
    const found = end - at > MAX_DELIMITER_LENGTH ? null : findDelimiter(source.toString('latin1', at, end), open);
    if (found !== null) {
      open.length = found.closes ? found.level : found.level + 1;
      if (!found.closes) return end + 1;
    }
    at = end + 1;
  }
  return 'none';
}

function typeOf({ contentType: { value } }: PartHeader, open: readonly OpenMultipart[]): string {
  const [, type, subtype] = /^([^\s/]+)\s*\/\s*([^\s/]+)/.exec(value) ?? [];
  return type === undefined || subtype === undefined ? open.at(-1)?.partType ?? 'text/plain' : `${type}/${subtype}`;
}

/** The text a person reads, which is no file. */
function isBodyText(type: string, { contentType, disposition }: PartHeader): boolean {
  return (type === 'text/plain' || type === 'text/html')
    && !/^attachment\b/.test(disposition.value) && !disposition.parameters.has('filename') && !contentType.parameters.has('name');
}

/**
 * Every part but multiparts and the text a person reads. An email in the email is one, whatever it holds.
 * Null for an email that is made of too much to count.
 */
export function countAttachments(source: Buffer): number | null {
  const email: Email = { source, open: [], headerBytes: MAX_HEADER_BYTES, delimiterLines: MAX_DELIMITER_LINES };
  const { open } = email;
  let attachments = 0;
  let at: number | 'none' | null = 0;
  for (let parts = 0; typeof at === 'number'; parts += 1) {
    const header = parts > MAX_PARTS ? null : readHeader(email, at);
    if (header === null) return null;
    const type = typeOf(header, open);
    const boundary = header.contentType.parameters.get('boundary');
    if (type.startsWith('multipart/') && open.length < MAX_DEPTH) {
      if (boundary !== undefined) open.push({ delimiter: `--${boundary}`, partType: type === 'multipart/digest' ? 'message/rfc822' : 'text/plain' });
    } else if (!isBodyText(type, header)) {
      attachments += 1;
    }
    at = nextPart(email, header.bodyAt);
  }
  return at === null ? null : attachments;
}
