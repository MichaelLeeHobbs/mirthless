export interface CodeTemplateData {
  readonly code: string;
  readonly type: string;
  readonly contexts: ReadonlyArray<string>;
}

const CONTEXT_MAP: Readonly<Record<string, string>> = {
  preprocessor: 'CHANNEL_PREPROCESSOR',
  postprocessor: 'CHANNEL_POSTPROCESSOR',
  sourceFilter: 'SOURCE_FILTER_TRANSFORMER',
  sourceTransformer: 'SOURCE_FILTER_TRANSFORMER',
  destinationFilter: 'DESTINATION_FILTER_TRANSFORMER',
  destinationTransformer: 'DESTINATION_FILTER_TRANSFORMER',
  destinationResponseTransformer: 'DESTINATION_RESPONSE_TRANSFORMER',
  sourceReceiver: 'SOURCE_RECEIVER',
  destinationDispatcher: 'DESTINATION_DISPATCHER',
  globalPreprocessor: 'GLOBAL_PREPROCESSOR',
  globalPostprocessor: 'GLOBAL_POSTPROCESSOR',
  deploy: 'CHANNEL_DEPLOY',
  undeploy: 'CHANNEL_UNDEPLOY',
  globalDeploy: 'GLOBAL_DEPLOY',
  globalUndeploy: 'GLOBAL_UNDEPLOY',
} as const;

/** CODE_BLOCK templates are for inline editor use, so only FUNCTION templates are prepended. */
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
