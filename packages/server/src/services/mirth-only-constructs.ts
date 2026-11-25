// Mirth script constructs GalvaniGraph does not run (D-244), with what to use instead. The import
// keeps scripts as written and lists these so the operator knows what to rewrite.

const MESSAGE_VARIABLE = "Mirth's 'message' variable: use rawData";

const MIRTH_ONLY_CONSTRUCTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:msg|tmp)\s*\[\s*['"]/, "E4X field access (msg['PID']...): use msg.get('PID.5.1') / msg.set, where [n] counts from 1, so Mirth's msg['OBX'][1]['OBX.5'] is msg.get('OBX[2].5')"],
  [/\bfor\s+each\s*\(/, "Rhino 'for each': use for...of"],
  [/\bnew\s+XML\s*\(/, 'E4X new XML(...): build HL7 with parseHL7 and msg.set'],
  [/\b(?:Packages|java|javax|org\.apache|com\.mirth)\./, 'Java classes: use JavaScript built-ins'],
  [/\b(?:channelMap|connectorMap|responseMap|globalMap|globalChannelMap|sourceMap|configurationMap)\.(?:put|get|containsKey|remove)\s*\(/, 'Java map methods (channelMap.put): use $c(key, value) or channelMap[key]'],
  [/\bconnectorMessage\.get\w+\s*\(/, 'connectorMessage.getRawData(): use rawData'],
  [/\b(?:ResponseFactory|DateUtil|FileUtil|SerializerFactory|ACKGenerator|ChannelUtil|AttachmentUtil|stringUtils|router)\./, 'Mirth user API objects: use the GalvaniGraph scripting API'],
  [/\b(?:return|String\()\s*message\b/, MESSAGE_VARIABLE],
  // Bounded, so that a script of many calls is not read to its end from each.
  [/\bvalidate\s*\([^;]{0,1000}?\bnew\s+Array\s*\(/, "Mirth's validate(value, default, replacements): use value || default, and String.replace for each replacement"],
  [/\bresponseStatus(?:Message)?\b|\bresponseErrorMessage\b/, "Mirth's responseStatus: a response transformer here cannot change whether the message counts as delivered"],
];

function hints(scripts: readonly string[], except: readonly string[] = []): readonly string[] {
  return MIRTH_ONLY_CONSTRUCTS
    .filter(([pattern, hint]) => !except.includes(hint) && scripts.some((s) => pattern.test(s)))
    .map(([, hint]) => hint);
}

/** `what` begins the warning: `Channel "A": its scripts use`. */
export function mirthOnlyWarning(what: string, scripts: readonly string[]): string | null {
  const found = hints(scripts);
  return found.length === 0 ? null : `${what} Mirth-only constructs that will fail until rewritten: ${found.join('; ')}`;
}

/** In a template's function `message` is a common parameter name, so it says nothing there. */
export function mirthOnlyTemplateWarning(what: string, code: string): string | null {
  const found = hints([code], [MESSAGE_VARIABLE]);
  return found.length === 0 ? null : `${what} Mirth-only constructs that will fail until rewritten: ${found.join('; ')}`;
}
