// ===========================================
// Script body type check
// ===========================================
// The engine runs every script as the body of an async function, and the
// deploy check type-checks it that way (wrapScriptBody). Checked on its own, a
// script's top-level `return` is an error TypeScript reports without checking
// the returned expression, so a type error there passed the editor (#206). A
// Monaco model cannot carry a hidden wrapper, so the editor's type errors come
// from a hidden model that holds the wrapped script, checked by the same
// TypeScript worker, and are set on the visible model under their own owner.
// The visible model keeps Monaco's syntax checking (monaco.ts).

import { useEffect } from 'react';
import { scriptBodyPosition, wrapScriptBody } from '@galvanigraph/core-models';
import { monaco } from './monaco.js';
import { errorMessage } from '../../lib/error-message.js';

type CodeEditor = monaco.editor.IStandaloneCodeEditor;
type Diagnostic = monaco.typescript.Diagnostic;
type MessageChain = Exclude<Diagnostic['messageText'], string>;

/** The owner of the type-error markers this check sets. */
export const SCRIPT_BODY_MARKER_OWNER = 'script-body';

/** Wait after the last keystroke before checking again, as Monaco's own checks do. */
const CHECK_DELAY_MS = 500;

/** A TypeScript message and the messages chained under it, one per line, each level indented. */
export function flattenMessage(text: Diagnostic['messageText']): string {
  if (typeof text === 'string') return text;
  const lines: string[] = [];
  const stack: Array<{ readonly chain: MessageChain; readonly depth: number }> = [{ chain: text, depth: 0 }];
  while (stack.length > 0) {
    const { chain, depth } = stack.pop()!;
    lines.push(`${'  '.repeat(depth)}${chain.messageText}`);
    // Pushed in reverse, so the first child is read first.
    for (const next of [...(chain.next ?? [])].reverse()) stack.push({ chain: next, depth: depth + 1 });
  }
  return lines.join('\n');
}

const SEVERITY: Readonly<Record<Diagnostic['category'], monaco.MarkerSeverity>> = {
  0: monaco.MarkerSeverity.Warning,
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Hint,
  3: monaco.MarkerSeverity.Info,
};

/**
 * Markers for the script from the diagnostics of its wrapped text, on the
 * script's own lines. `positionAt` turns an offset in the wrapped text into
 * its 1-based line and column.
 */
export function scriptBodyMarkers(
  code: string,
  diagnostics: readonly Diagnostic[],
  positionAt: (offset: number) => { readonly lineNumber: number; readonly column: number },
): monaco.editor.IMarkerData[] {
  return diagnostics.map((d) => {
    const startOffset = d.start ?? 0;
    const start = positionAt(startOffset);
    const end = positionAt(startOffset + (d.length ?? 1));
    const from = scriptBodyPosition(code, start.lineNumber, start.column);
    const to = scriptBodyPosition(code, end.lineNumber, end.column);
    return {
      severity: SEVERITY[d.category],
      message: flattenMessage(d.messageText),
      code: String(d.code),
      startLineNumber: from.line,
      startColumn: from.column,
      endLineNumber: to.line,
      endColumn: to.column,
    };
  });
}

let hiddenModels = 0;

/**
 * A model for the wrapped copy of a script. Plain text, so Monaco's own
 * TypeScript checks leave it alone; the worker still reads it as TypeScript by
 * its .ts name. Every hidden model declares the same wrapper function, and
 * what the script declares is local to it. They do not clash only because
 * SCRIPT_COMPILER_OPTIONS sets `moduleDetection` to Force, which makes each
 * file a module: without it the wrapper's name is global and two hidden models
 * report "Duplicate function implementation" (2393).
 */
function createBodyModel(): monaco.editor.ITextModel {
  hiddenModels += 1;
  return monaco.editor.createModel('', 'plaintext', monaco.Uri.parse(`file:///script-body/${String(hiddenModels)}.ts`));
}

/** Check the script in `model` through `body`, its hidden wrapped copy; resolves to its markers. */
async function checkBody(model: monaco.editor.ITextModel, body: monaco.editor.ITextModel): Promise<monaco.editor.IMarkerData[]> {
  const code = model.getValue();
  body.setValue(wrapScriptBody(code));
  const worker = await (await monaco.typescript.getTypeScriptWorker())(body.uri);
  const diagnostics = await worker.getSemanticDiagnostics(body.uri.toString());
  return scriptBodyMarkers(code, diagnostics, (offset) => body.getPositionAt(offset));
}

/** The marker for a check that failed: deploy still checks, so say the editor could not. */
function checkFailed(err: unknown): monaco.editor.IMarkerData[] {
  return [{
    severity: monaco.MarkerSeverity.Warning,
    message: `Types could not be checked here: ${errorMessage(err, 'the type checker failed')}`,
    startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1,
  }];
}

/**
 * Type-check the editor's script as the body of the function the engine runs
 * it in, while `active` (a TypeScript script whose surface is the one applied,
 * see surface-state.ts). Inactive, the editor shows no type errors.
 */
export function useScriptBodyTypeMarkers(editor: CodeEditor | null, active: boolean): void {
  useEffect(() => {
    const model = editor?.getModel();
    if (!model) return undefined;
    if (!active) {
      monaco.editor.setModelMarkers(model, SCRIPT_BODY_MARKER_OWNER, []);
      return undefined;
    }
    const body = createBodyModel();
    let latest = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (): void => {
      latest += 1;
      const run = latest;
      const version = model.getVersionId();
      // Only the latest check's answer counts (an older one may finish later),
      // and only for the text it checked: its lines may not match newer text,
      // whose own check is already scheduled.
      const set = (markers: monaco.editor.IMarkerData[]): void => {
        if (run !== latest || model.isDisposed() || model.getVersionId() !== version) return;
        monaco.editor.setModelMarkers(model, SCRIPT_BODY_MARKER_OWNER, markers);
      };
      checkBody(model, body).then(set, (err: unknown) => { set(checkFailed(err)); });
    };
    const later = (): void => { clearTimeout(timer); timer = setTimeout(check, CHECK_DELAY_MS); };
    // Not at once: this editor's surface was applied just before, and Monaco
    // hands the new declarations to the worker on a timer. Checking now could
    // reach the worker first and check against the old ones.
    later();
    const content = model.onDidChangeContent(later);
    // Another surface's declarations, or new templates: check again.
    const libs = monaco.typescript.typescriptDefaults.onDidExtraLibsChange(later);
    return () => {
      clearTimeout(timer);
      latest += 1;
      content.dispose();
      libs.dispose();
      body.dispose();
      if (!model.isDisposed()) monaco.editor.setModelMarkers(model, SCRIPT_BODY_MARKER_OWNER, []);
    };
  }, [editor, active]);
}
