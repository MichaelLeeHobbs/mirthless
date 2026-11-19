// Scripts edit XML as a plain object, which cannot hold document order: repeated
// elements are grouped into one array and the text around child elements is
// joined into one `#text`. So the edited object is written back in the original
// document's order: removed elements are dropped, added ones appended to their
// parent, and comments, CDATA and whitespace the script cannot see stay put.

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { isPlainObject } from '@galvanigraph/core-util';

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

interface Work {
  readonly edited: unknown;
  /** The unedited value, to tell whether the text changed. */
  readonly before: unknown;
  readonly original: readonly OrderedNode[];
  readonly out: OrderedNode[];
}

function tagOf(node: OrderedNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ATTRS) return key;
  }
  return TEXT;
}

function occurrences(parent: unknown, tag: string): readonly unknown[] {
  if (!isPlainObject(parent) || !Object.hasOwn(parent, tag)) return [];
  const value = parent[tag];
  if (Array.isArray(value)) return value as readonly unknown[];
  return value === undefined ? [] : [value];
}

function textOf(value: unknown): string {
  if (isPlainObject(value)) return value[TEXT] === undefined || value[TEXT] === null ? '' : String(value[TEXT]);
  if (value === undefined || value === null || Array.isArray(value)) return '';
  return String(value);
}

function isBlankText(node: OrderedNode): boolean {
  return typeof node[TEXT] === 'string' && node[TEXT].trim() === '';
}

function attributesOf(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const attrs: Record<string, string> = {};
  let any = false;
  for (const [key, attr] of Object.entries(value)) {
    if (!key.startsWith(ATTR_PREFIX) || attr === undefined || attr === null) continue;
    attrs[key] = String(attr);
    any = true;
  }
  return any ? attrs : undefined;
}

function element(tag: string, edited: unknown, before: unknown, original: readonly OrderedNode[], stack: Work[]): OrderedNode {
  const children: OrderedNode[] = [];
  const node: OrderedNode = { [tag]: children };
  const attrs = attributesOf(edited);
  if (attrs) node[ATTRS] = attrs;
  stack.push({ edited, before, original, out: children });
  return node;
}

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

function appendAdded(work: Work, used: Map<string, number>, stack: Work[]): void {
  if (!isPlainObject(work.edited)) return;
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

/** `before` is the object form of `original` before the script ran. */
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
