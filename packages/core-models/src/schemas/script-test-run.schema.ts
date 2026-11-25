// Runs one script against a sample message with no side effects (the engine's script-test-run.ts).

import { z } from 'zod/v4';
import { codeTemplateContextSchema } from './code-template.schema.js';
import { idSchema } from './id.schema.js';

export const SCRIPT_TEST_KINDS = ['filter', 'transformer', 'script'] as const;

const dataTypeSchema = z.enum(['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR', 'X12']);

export const scriptTestRunSchema = z.object({
  // Script and sample together stay under the API's 1 MB JSON body limit.
  script: z.string().max(256 * 1024),
  /** filter: a filter rule; transformer: a transformer step; script: any other script. */
  kind: z.enum(SCRIPT_TEST_KINDS),
  /** Not stored or logged: it can hold PHI. */
  sample: z.string().max(512 * 1024),
  /** Omit for a script that runs without a message. */
  dataType: dataTypeSchema.optional(),
  /** Decides the templates the script can call. */
  templateContext: codeTemplateContextSchema.optional(),
  /** True for source filters and transformers, which see destinationSet. */
  destinationSet: z.boolean().default(false),
  /** The channel being edited: scopes templates, names destinations and sets the timeout. */
  channelId: idSchema.optional(),
});

export type ScriptTestRunInput = z.infer<typeof scriptTestRunSchema>;

/** A failing script is an outcome, not a request error. */
export interface ScriptTestResult {
  /** filter: accepted/filtered; transformer and script: completed; any failure: error. */
  readonly outcome: 'accepted' | 'filtered' | 'completed' | 'error';
  /** The message after a transformer or script, serialized as the pipeline would. */
  readonly output: string | null;
  /** As text; null when the script returned nothing. */
  readonly returned: string | null;
  readonly logs: ReadonlyArray<{ readonly level: string; readonly message: string }>;
  /** Map entries the script set, by map name. */
  readonly maps: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** Destinations the message would still go to (source scripts only). */
  readonly destinations: readonly string[] | null;
  /** Calls that would have had side effects and were not performed. */
  readonly skipped: readonly string[];
  readonly error: string | null;
  readonly durationMs: number;
}
