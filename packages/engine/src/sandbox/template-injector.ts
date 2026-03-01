// ===========================================
// Template Injector
// ===========================================
// Prepends applicable code template functions to user scripts
// before compilation, making them available in the sandbox.

// ----- Types -----

/** Minimal code template data needed for injection. */
export interface CodeTemplateData {
  readonly code: string;
  readonly type: string;
  readonly contexts: ReadonlyArray<string>;
}

// ----- Context Mapping -----

/** Map script context keys to template context values. */
const CONTEXT_MAP: Readonly<Record<string, string>> = {
  preprocessor: 'CHANNEL_PREPROCESSOR',
  postprocessor: 'CHANNEL_POSTPROCESSOR',
  sourceFilter: 'SOURCE_FILTER_TRANSFORMER',
  sourceTransformer: 'SOURCE_FILTER_TRANSFORMER',
  destinationFilter: 'DESTINATION_FILTER_TRANSFORMER',
  destinationTransformer: 'DESTINATION_FILTER_TRANSFORMER',
  globalPreprocessor: 'GLOBAL_PREPROCESSOR',
  globalPostprocessor: 'GLOBAL_POSTPROCESSOR',
} as const;

// ----- Implementation -----

/**
 * Prepend applicable FUNCTION templates to a user script for the given context.
 * Only FUNCTION type templates are prepended (they define reusable functions).
 * CODE_BLOCK templates are for inline editor use and are skipped.
 */
export function prependTemplates(
  userScript: string,
  templates: ReadonlyArray<CodeTemplateData>,
  scriptContext: string,
): string {
  const templateContext = CONTEXT_MAP[scriptContext];
  if (!templateContext) return userScript;

  const applicable = templates.filter(
    (t) => t.type === 'FUNCTION' && t.contexts.includes(templateContext),
  );

  if (applicable.length === 0) return userScript;

  const preamble = applicable.map((t) => t.code).join('\n');
  return `${preamble}\n${userScript}`;
}
