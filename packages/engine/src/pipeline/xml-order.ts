// ===========================================
// Order-Preserving XML Serializer
// ===========================================
// Scripts edit XML as a plain object (`msg.patient.name = 'X'`). That object
// cannot hold document order: repeated elements are grouped into one array and
// the text around child elements is joined into one `#text`. Building XML
// straight from it moves elements and text around.
//
// This serializer writes the edited object back in the ORIGINAL document's
// order. It walks the original as an ordered tree and, for each node, emits
// what the edited object now holds for it. Elements the script removed are
// dropped, elements it added are appended to their parent, and comments,
// CDATA sections and whitespace the script cannot see are kept where they were.

import { XMLParser, XMLBuilder } from 'fast-xml-parser';

const ATTR_PREFIX = '@_';
const TEXT = '#text';
const COMMENT = '#comment';
const CDATA = '#cdata';
const ATTRS = ':@';

const ENTITY_LIMITS = {
  enabled: true,
  maxEntityCount: 100,
  maxEntitySize: 10_000,
  maxExpansionDepth: 10,
  maxTotalExpansions: 10_000,
  maxExpandedLength: 1_000_000,
} as const;

const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  allowBooleanAttributes: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  commentPropName: COMMENT,
  cdataPropName: CDATA,
  processEntities: ENTITY_LIMITS,
});

const orderedBuilder = new XMLBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: ATTR_PREFIX,
  commentPropName: COMMENT,
  cdataPropName: CDATA,
  format: false,
  suppressEmptyNode: false,
});

/** A node of fast-xml-parser's ordered tree: one tag key holding its children, plus optional attributes. */
type OrderedNode = Record<string, unknown>;

/** One element's content still to be written. */
interface Work {
  /** What the edited object holds for this element. */
  readonly edited: unknown;
  /** What the unedited object held for it, to tell whether its text changed. */
  readonly before: unknown;
  /** The element's children in the original document. */
  readonly original: readonly OrderedNode[];
  /** Where the merged children go. */
  readonly out: OrderedNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The single tag name of an ordered node (`#text`, `#comment`, `#cdata` or an element name). */
function tagOf(node: OrderedNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ATTRS) return key;
  }
  return TEXT;
}

/** Every value the object form holds under a tag: an array for repeated elements, one value otherwise. */
function occurrences(parent: unknown, tag: string): readonly unknown[] {
  if (!isRecord(parent) || !Object.hasOwn(parent, tag)) return [];
  const value = parent[tag];
  if (Array.isArray(value)) return value as readonly unknown[];
  return value === undefined ? [] : [value];
}

/** The text an element holds in the object form: the value itself for a leaf, `#text` otherwise. */
function textOf(value: unknown): string {
  if (isRecord(value)) return value[TEXT] === undefined || value[TEXT] === null ? '' : String(value[TEXT]);
  if (value === undefined || value === null || Array.isArray(value)) return '';
  return String(value);
}

function isBlankText(node: OrderedNode): boolean {
  return typeof node[TEXT] === 'string' && node[TEXT].trim() === '';
}

function attributesOf(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const attrs: Record<string, string> = {};
  let any = false;
  for (const [key, attr] of Object.entries(value)) {
    if (!key.startsWith(ATTR_PREFIX) || attr === undefined || attr === null) continue;
    attrs[key] = String(attr);
    any = true;
  }
  return any ? attrs : undefined;
}

/** Start an element node and queue its content. */
function element(tag: string, edited: unknown, before: unknown, original: readonly OrderedNode[], stack: Work[]): OrderedNode {
  const children: OrderedNode[] = [];
  const node: OrderedNode = { [tag]: children };
  const attrs = attributesOf(edited);
  if (attrs) node[ATTRS] = attrs;
  stack.push({ edited, before, original, out: children });
  return node;
}

/** Write the original children of one element, in their order, with the edited values. */
function mergeOriginal(work: Work, used: Map<string, number>, stack: Work[]): void {
  const textChanged = textOf(work.edited) !== textOf(work.before);
  let wroteText = !textChanged;
  for (const node of work.original) {
    const tag = tagOf(node);
    if (tag === COMMENT) { work.out.push(node); continue; }
    if (tag === TEXT || tag === CDATA) {
      // Whitespace between elements is formatting the script never saw: keep it.
      if (!textChanged || (tag === TEXT && isBlankText(node) && work.original.length > 1)) { work.out.push(node); continue; }
      if (!wroteText && textOf(work.edited) !== '') work.out.push({ [TEXT]: textOf(work.edited) });
      wroteText = true;
      continue;
    }
    const index = used.get(tag) ?? 0;
    used.set(tag, index + 1);
    const now = occurrences(work.edited, tag);
    if (index >= now.length) continue; // removed by the script
    const kids = Array.isArray(node[tag]) ? node[tag] as readonly OrderedNode[] : [];
    work.out.push(element(tag, now[index], occurrences(work.before, tag)[index], kids, stack));
  }
  if (!wroteText && textOf(work.edited) !== '') work.out.unshift({ [TEXT]: textOf(work.edited) });
}

/** Append the elements the script added: anything the original walk did not account for. */
function appendAdded(work: Work, used: Map<string, number>, stack: Work[]): void {
  if (!isRecord(work.edited)) return;
  for (const key of Object.keys(work.edited)) {
    if (key === TEXT || key.startsWith(ATTR_PREFIX)) continue;
    const now = occurrences(work.edited, key);
    for (let i = used.get(key) ?? 0; i < now.length; i++) {
      work.out.push(element(key, now[i], undefined, [], stack));
    }
  }
}

function parseOrdered(original: string | undefined): readonly OrderedNode[] {
  if (original === undefined) return [];
  try {
    return orderedParser.parse(original) as OrderedNode[];
  } catch {
    // The original is not XML (the script built the document from other data).
    return [];
  }
}

/**
 * Serialize the object form of an XML document.
 *
 * @param edited - The object a script returned (or the parsed message it edited).
 * @param before - The object form of `original` before the script ran.
 * @param original - The XML text the object was parsed from, when there is one.
 */
export function buildXmlInOriginalOrder(edited: unknown, before: unknown, original: string | undefined): string {
  const root: OrderedNode[] = [];
  const stack: Work[] = [{ edited, before, original: parseOrdered(original), out: root }];
  while (stack.length > 0) {
    const work = stack.pop()!;
    const used = new Map<string, number>();
    mergeOriginal(work, used, stack);
    appendAdded(work, used, stack);
  }
  return orderedBuilder.build(root) as string;
}
