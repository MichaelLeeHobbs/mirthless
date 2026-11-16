// ===========================================
// FILE Connector Property Schemas
// ===========================================
// Properties of the File Reader (source) and Writer (destination), as a
// channel stores them. The server validates them at deploy and the connector
// registry parses them, so defaults live here only. A key not listed here
// fails validation.
//
// Which `${name}` placeholders an output pattern may use is checked by the
// dispatcher (packages/connectors/src/file/file-dispatcher.ts), which fills them.

import { z } from 'zod/v4';
import {
  wholeNumberSchema,
  pollingIntervalSchema,
  requiredTextSchema,
  charsetSchema,
  sourceCommonProperties,
  destinationCommonProperties,
} from './connector-property-fields.js';

/** The order the source reads the files of one poll in. */
export const FILE_SORT_ORDERS = ['NAME', 'DATE', 'SIZE'] as const;

/** What the source does with a file once the pipeline has taken it. */
export const FILE_POST_ACTIONS = ['DELETE', 'MOVE', 'NONE'] as const;

/** The source's keys; the docs guard compares them with the connector reference. */
export const fileSourceObjectSchema = z.strictObject({
  directory: requiredTextSchema,
  /** Glob (`*`, `?`) for the files to read, case-sensitive as Mirth's (D-304). */
  fileFilter: requiredTextSchema.default('*'),
  /** Leave names starting with `.` alone, as a Mirth File Reader does by default. */
  ignoreDot: z.boolean().default(true),
  /** The receiver refuses to poll more often than every 100 ms. */
  pollingIntervalMs: pollingIntervalSchema(100, 5_000),
  sortBy: z.enum(FILE_SORT_ORDERS).default('NAME'),
  charset: charsetSchema,
  /** Read the file as base64 instead of text. */
  binary: z.boolean().default(false),
  checkFileAge: z.boolean().default(true),
  /** Milliseconds a file must be unchanged before it is read, when checkFileAge is on. */
  fileAgeMs: wholeNumberSchema(0).default(1_000),
  postAction: z.enum(FILE_POST_ACTIONS).default('DELETE'),
  moveToDirectory: z.string().default(''),
  ...sourceCommonProperties,
});

/** The destination's keys; the docs guard compares them with the connector reference. */
export const fileDestinationObjectSchema = z.strictObject({
  directory: requiredTextSchema,
  /** File name; `${messageId}` and `${timestamp}` are filled. */
  outputPattern: requiredTextSchema.default('${messageId}.txt'),
  charset: charsetSchema,
  /** Decode the content from base64 and write the bytes. */
  binary: z.boolean().default(false),
  /** Write a temporary file, then rename it. */
  tempFileEnabled: z.boolean().default(true),
  appendMode: z.boolean().default(false),
  ...destinationCommonProperties,
});

/** The source schema, needing a move-to directory when the post action is MOVE. */
export const fileSourcePropertiesSchema = fileSourceObjectSchema.superRefine((props, ctx) => {
  if (props.postAction === 'MOVE' && props.moveToDirectory.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['moveToDirectory'], message: 'required when postAction is MOVE' });
  }
});
export type FileSourceProperties = z.infer<typeof fileSourceObjectSchema>;

export const fileDestinationPropertiesSchema = fileDestinationObjectSchema;
export type FileDestinationProperties = z.infer<typeof fileDestinationObjectSchema>;
