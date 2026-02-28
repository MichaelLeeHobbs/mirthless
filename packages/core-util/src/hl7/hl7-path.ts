// ===========================================
// HL7v2 Path Parser
// ===========================================
// Parses HL7 path strings like 'PID.3.1' into
// structured objects for field access.

/** Parsed HL7 path with all indices resolved. */
export interface Hl7Path {
  readonly segment: string;
  readonly segmentIndex: number;
  readonly field: number | undefined;
  readonly fieldRepetition: number | undefined;
  readonly component: number | undefined;
  readonly subComponent: number | undefined;
}

const PATH_REGEX = /^([A-Z][A-Z0-9]{2})(?:\[(\d+)\])?(?:\.(\d+)(?:\[(\d+)\])?(?:\.(\d+)(?:\.(\d+))?)?)?$/;

/**
 * Parse an HL7 path string into its components.
 * Auto-resolves missing indices to 1 for get operations.
 */
export function parsePath(path: string, autoResolve = true): Hl7Path {
  if (!path || typeof path !== 'string') {
    throw new Error('Path must be a non-empty string');
  }

  const matches = PATH_REGEX.exec(path.trim());
  if (!matches) {
    throw new Error(`Invalid HL7 path: ${path}`);
  }

  const segment = matches[1]!;
  const rawSegIdx = matches[2];
  const rawField = matches[3];
  const rawFieldRep = matches[4];
  const rawComp = matches[5];
  const rawSub = matches[6];

  let segmentIndex = rawSegIdx ? parseInt(rawSegIdx, 10) : undefined;
  const field = rawField ? parseInt(rawField, 10) : undefined;
  let fieldRepetition = rawFieldRep ? parseInt(rawFieldRep, 10) : undefined;
  let component = rawComp ? parseInt(rawComp, 10) : undefined;
  let subComponent = rawSub ? parseInt(rawSub, 10) : undefined;

  // Auto-resolve: fill in 1 for missing intermediate indices
  if (field !== undefined && segmentIndex === undefined) {
    segmentIndex = 1;
  }
  if (component !== undefined && fieldRepetition === undefined) {
    fieldRepetition = 1;
  }

  if (autoResolve) {
    if (segment) segmentIndex = segmentIndex ?? 1;
    if (field !== undefined) fieldRepetition = fieldRepetition ?? 1;
    if (fieldRepetition !== undefined) component = component ?? 1;
    if (component !== undefined) subComponent = subComponent ?? 1;
  }

  return { segment, segmentIndex: segmentIndex ?? 1, field, fieldRepetition, component, subComponent };
}
