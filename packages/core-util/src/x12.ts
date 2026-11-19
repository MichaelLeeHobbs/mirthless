/** ISA is fixed width: 106 characters, the last being the segment terminator. */
const ISA_LENGTH = 106;
const ELEMENT_SEPARATOR_AT = 3;
const COMPONENT_SEPARATOR_AT = 104;
const SEGMENT_TERMINATOR_AT = 105;

const PATH = /^([A-Z][A-Z0-9]{1,2})(?:\[(\d+)\])?(?:\.(\d+)(?:\.(\d+))?)?$/;

interface X12Path {
  readonly segment: string;
  /** 1-based occurrence of the segment. */
  readonly occurrence: number;
  /** 1-based element number, or undefined for the whole segment. */
  readonly element: number | undefined;
  /** 1-based component number, or undefined for the whole element. */
  readonly component: number | undefined;
}

function parsePath(path: string): X12Path {
  const match = PATH.exec(path.trim());
  if (!match) throw new Error(`Invalid X12 path "${path}": expected SEG, SEG.e, SEG[n].e or SEG[n].e.c`);
  const number = (text: string | undefined): number | undefined => (text === undefined ? undefined : Number(text));
  const occurrence = number(match[2]) ?? 1;
  const element = number(match[3]);
  const component = number(match[4]);
  if (occurrence < 1 || element === 0 || component === 0) throw new Error(`Invalid X12 path "${path}": positions start at 1`);
  return { segment: match[1]!, occurrence, element, component };
}

/** Each segment holds its id at index 0, so element N is at index N. */
export class X12Message {
  private constructor(
    private readonly segments: string[][],
    private readonly elementSeparator: string,
    private readonly componentSeparator: string,
    private readonly terminator: string,
    /** The terminator plus any line break written after it. */
    private readonly segmentEnd: string,
  ) {}

  /** Throws without a full ISA, which holds the delimiters. */
  static parse(text: string): X12Message {
    const body = text.replace(/^\s+/, '');
    if (!body.startsWith('ISA') || body.length < ISA_LENGTH) {
      throw new Error('X12 must start with a complete 106-character ISA segment');
    }
    const elementSeparator = body[ELEMENT_SEPARATOR_AT]!;
    // The delimiters are read by position, so the ISA must be the fixed-width
    // form: 16 elements, padded, with ISA16 the one character before the
    // terminator. An unpadded ISA would make some other character the terminator.
    const isa = body.slice(0, SEGMENT_TERMINATOR_AT);
    if (isa.split(elementSeparator).length !== 17 || body[COMPONENT_SEPARATOR_AT - 1] !== elementSeparator) {
      throw new Error('X12 ISA segment is not the fixed-width 106-character form (are ISA02/ISA04/ISA06/ISA08 padded with spaces?)');
    }
    const componentSeparator = body[COMPONENT_SEPARATOR_AT]!;
    const terminator = body[SEGMENT_TERMINATOR_AT]!;
    const lineBreak = /^[\r\n]*/.exec(body.slice(ISA_LENGTH))?.[0] ?? '';
    const segments = body.split(terminator)
      .map((segment) => segment.replace(/^[\r\n]+/, ''))
      .filter((segment) => segment.trim() !== '')
      .map((segment) => segment.split(elementSeparator));
    return new X12Message(segments, elementSeparator, componentSeparator, terminator, terminator + lineBreak);
  }

  /** Refuse a value that holds a delimiter, which would turn it into more elements, components or segments. */
  private checkValue(value: string, component: boolean): void {
    const delimiters = component ? [this.elementSeparator, this.terminator, this.componentSeparator] : [this.elementSeparator, this.terminator];
    const found = delimiters.find((d) => value.includes(d));
    if (found !== undefined) throw new Error(`X12 value cannot contain the delimiter "${found}"`);
  }

  private indexesOf(id: string): number[] {
    const found: number[] = [];
    this.segments.forEach((segment, index) => { if (segment[0] === id) found.push(index); });
    return found;
  }

  private find(path: X12Path): string[] | undefined {
    const index = this.indexesOf(path.segment)[path.occurrence - 1];
    return index === undefined ? undefined : this.segments[index];
  }

  /** A segment path returns the segment's text. */
  get(path: string): string | undefined {
    const p = parsePath(path);
    const segment = this.find(p);
    if (!segment) return undefined;
    if (p.element === undefined) return segment.join(this.elementSeparator);
    const element = segment[p.element];
    if (element === undefined || p.component === undefined) return element;
    return element.split(this.componentSeparator)[p.component - 1];
  }

  /**
   * Throws when the segment is not there or the value holds a delimiter (an
   * element may hold component separators: it is a composite).
   */
  set(path: string, value: string): void {
    const p = parsePath(path);
    const segment = this.find(p);
    if (!segment) throw new Error(`X12 message has no ${p.segment}[${String(p.occurrence)}] segment`);
    if (p.element === undefined) throw new Error(`Set an element of ${p.segment}, not the whole segment`);
    this.checkValue(value, p.component !== undefined);
    while (segment.length <= p.element) segment.push('');
    if (p.component === undefined) {
      segment[p.element] = value;
      return;
    }
    const components = segment[p.element]!.split(this.componentSeparator);
    while (components.length < p.component) components.push('');
    components[p.component - 1] = value;
    segment[p.element] = components.join(this.componentSeparator);
  }

  /** Removes a segment, but only empties an element or component. */
  delete(path: string): void {
    const p = parsePath(path);
    if (p.element === undefined) {
      const index = this.indexesOf(p.segment)[p.occurrence - 1];
      if (index !== undefined) this.segments.splice(index, 1);
      return;
    }
    if (this.get(path) !== undefined) this.set(path, '');
  }

  getSegmentCount(id: string): number {
    return this.indexesOf(id).length;
  }

  toString(): string {
    return this.segments.map((segment) => segment.join(this.elementSeparator) + this.segmentEnd).join('');
  }
}
