// How many attachments an email has, from its own bytes (#369, D-388). Time is linear in them, whoever wrote them.

/** A multipart whose parts are being read. */
interface OpenMultipart {
  /** The line before each part. The one after the last has two more hyphens. */
  readonly delimiter: string;
  /** Of a part that names none. */
  readonly partType: string;
}

interface Field {
  /** In lower case, up to the first parameter. */
  readonly value: string;
  readonly parameters: ReadonlyMap<string, string>;
}

interface PartHeader {
  readonly contentType: Field;
  readonly disposition: Field;
  readonly bodyAt: number;
}

/** A multipart nested deeper counts as one attachment. */
const MAX_DEPTH = 20;
/** RFC 5322 allows a line 998 characters. */
const MAX_DELIMITER_LINE = 1_000;
const LINE_FEED = 0x0a;
const HYPHEN = 0x2d;
const CONTENT_TYPE = 'content-type';
const DISPOSITION = 'content-disposition';

function lineEnd(source: Buffer, at: number): number {
  const end = source.indexOf(LINE_FEED, at);
  return end === -1 ? source.length : end;
}

/** The value of a parameter at `at`, quoted or not, and where it ends. */
function parameterValue(text: string, at: number): { readonly value: string; readonly end: number } {
  if (text[at] !== '"') {
    const end = text.indexOf(';', at);
    return end === -1 ? { value: text.slice(at).trim(), end: text.length } : { value: text.slice(at, end).trim(), end };
  }
  const characters: string[] = [];
  let i = at + 1;
  for (; i < text.length && text[i] !== '"'; i += 1) {
    if (text[i] === '\\') i += 1;
    characters.push(text[i] ?? '');
  }
  return { value: characters.join(''), end: i + 1 };
}

/** Of `name*0`, `name*` and the like, the name without its star (RFC 2231). */
function parseField(text: string): Field {
  const parameters = new Map<string, string>();
  let at = text.indexOf(';');
  while (at !== -1) {
    let equals = at + 1;
    while (equals < text.length && text[equals] !== '=' && text[equals] !== ';') equals += 1;
    if (text[equals] !== '=') {
      at = equals < text.length ? equals : -1;
      continue;
    }
    const name = text.slice(at + 1, equals).trim().toLowerCase().split('*', 1)[0] ?? '';
    let start = equals + 1;
    while (text[start] === ' ' || text[start] === '\t') start += 1;
    const { value, end } = parameterValue(text, start);
    if (value !== '' && !parameters.has(name)) parameters.set(name, value);
    at = text.indexOf(';', end);
  }
  return { value: (/^[^\s;(]*/.exec(text.trimStart())?.[0] ?? '').toLowerCase(), parameters };
}

function findDelimiter(line: string, open: readonly OpenMultipart[]): { readonly level: number; readonly closes: boolean } | null {
  if (!line.startsWith('--') || line.length > MAX_DELIMITER_LINE) return null;
  const text = line.trimEnd();
  for (let level = open.length - 1; level >= 0; level -= 1) {
    const { delimiter } = open[level]!;
    if (text === delimiter) return { level, closes: false };
    if (text.length === delimiter.length + 2 && text === `${delimiter}--`) return { level, closes: true };
  }
  return null;
}

function readHeader(source: Buffer, start: number, open: readonly OpenMultipart[]): PartHeader {
  const fields = new Map<string, string[]>();
  let current: string[] | undefined;
  let at = start;
  let bodyAt = source.length;
  while (at < source.length) {
    const end = lineEnd(source, at);
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

/** Where the header of the next part starts. Closes the multiparts that end before it. */
function nextPart(source: Buffer, bodyAt: number, open: OpenMultipart[]): number | null {
  let at = bodyAt;
  while (at < source.length && open.length > 0) {
    const end = lineEnd(source, at);
    const found = source[at] === HYPHEN && source[at + 1] === HYPHEN && end - at <= MAX_DELIMITER_LINE
      ? findDelimiter(source.toString('latin1', at, end), open)
      : null;
    if (found !== null) {
      open.length = found.closes ? found.level : found.level + 1;
      if (!found.closes) return end + 1;
    }
    at = end + 1;
  }
  return null;
}

/** The text a person reads, which is no file. */
function isBodyText(type: string, { contentType, disposition }: PartHeader): boolean {
  return (type === 'text/plain' || type === 'text/html')
    && disposition.value !== 'attachment' && !disposition.parameters.has('filename') && !contentType.parameters.has('name');
}

/** Every part but multiparts and the text a person reads. An email in the email is one, whatever it holds. */
export function countAttachments(source: Buffer): number {
  const open: OpenMultipart[] = [];
  let attachments = 0;
  let at: number | null = 0;
  while (at !== null) {
    const header = readHeader(source, at, open);
    const { value, parameters } = header.contentType;
    const type = /^[^/]+\/[^/]+$/.test(value) ? value : open.at(-1)?.partType ?? 'text/plain';
    const boundary = parameters.get('boundary');
    if (type.startsWith('multipart/') && open.length < MAX_DEPTH) {
      if (boundary !== undefined) open.push({ delimiter: `--${boundary}`, partType: type === 'multipart/digest' ? 'message/rfc822' : 'text/plain' });
    } else if (!isBodyText(type, header)) {
      attachments += 1;
    }
    at = nextPart(source, header.bodyAt, open);
  }
  return attachments;
}
