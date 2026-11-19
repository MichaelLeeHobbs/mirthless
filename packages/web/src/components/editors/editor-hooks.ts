import { useEffect, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { monaco, overflowWidgetsHost } from './monaco.js';
import { editorThemeName } from '../../styles/editor-theme.js';

type CodeEditor = monaco.editor.IStandaloneCodeEditor;

export function useEditorTheme(): string {
  return editorThemeName(useTheme().palette.mode);
}

export interface Problem {
  readonly severity: 'error' | 'warning';
  readonly kind: 'syntax' | 'type';
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

/** TypeScript numbers its syntax diagnostics 1000-1999 and type diagnostics from 2000. */
export function problemKind(code: string | { readonly value: string } | undefined): Problem['kind'] {
  const value = typeof code === 'object' ? code.value : code;
  const n = Number(value);
  return Number.isFinite(n) && n >= 2000 ? 'type' : 'syntax';
}

export function toProblems(markers: readonly monaco.editor.IMarker[]): Problem[] {
  return markers
    .filter((m) => m.severity >= monaco.MarkerSeverity.Warning)
    .map((m): Problem => ({
      severity: m.severity === monaco.MarkerSeverity.Error ? 'error' : 'warning',
      kind: problemKind(m.code),
      message: m.message,
      line: m.startLineNumber,
      column: m.startColumn,
    }))
    .sort((a, b) => (a.severity === b.severity ? a.line - b.line || a.column - b.column : a.severity === 'error' ? -1 : 1));
}

export function useProblems(editor: CodeEditor | null): readonly Problem[] {
  const [problems, setProblems] = useState<readonly Problem[]>([]);
  useEffect(() => {
    if (!editor) return undefined;
    const read = (): void => {
      const model = editor.getModel();
      setProblems(model ? toProblems(monaco.editor.getModelMarkers({ resource: model.uri })) : []);
    };
    read();
    const markers = monaco.editor.onDidChangeMarkers((uris) => {
      const model = editor.getModel();
      if (model && uris.some((u) => u.toString() === model.uri.toString())) read();
    });
    const modelChange = editor.onDidChangeModel(read);
    return () => { markers.dispose(); modelChange.dispose(); };
  }, [editor]);
  return problems;
}

export function useCursor(editor: CodeEditor | null): { readonly line: number; readonly column: number } {
  const [pos, setPos] = useState({ line: 1, column: 1 });
  useEffect(() => {
    if (!editor) return undefined;
    const sub = editor.onDidChangeCursorPosition((e) => { setPos({ line: e.position.lineNumber, column: e.position.column }); });
    return () => { sub.dispose(); };
  }, [editor]);
  return pos;
}

/** With the completion list open, `logger.` is half typed, not wrong: the syntax error at the cursor is left out until the list closes. */
export function settledProblems(
  problems: readonly Problem[], cursor: { readonly line: number; readonly column: number }, completing: boolean,
): readonly Problem[] {
  if (!completing) return problems;
  return problems.filter((p) => !(p.kind === 'syntax' && p.line === cursor.line && Math.abs(p.column - cursor.column) <= 1));
}

export function suggestRoom(host: HTMLElement): number {
  const list = host.querySelector<HTMLElement>('.suggest-widget.visible');
  if (!list) return 0;
  // The documentation panel opens beside the list and can be the taller of the two.
  const docs = host.querySelector<HTMLElement>('.suggest-details-container');
  return Math.max(list.offsetHeight, docs?.offsetHeight ?? 0) + 8;
}

/** Keeps the completion list inside a fit-to-content editor, off the status line. It renders in the shared popup host, so this watches the host and answers only for the focused editor. */
export function useSuggestRoom(editor: CodeEditor | null): number {
  const [room, setRoom] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    const update = (): void => { setRoom(editor.hasTextFocus() ? suggestRoom(overflowWidgetsHost) : 0); };
    const observer = new MutationObserver(update);
    observer.observe(overflowWidgetsHost, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const blur = editor.onDidBlurEditorText(() => { setRoom(0); });
    return () => { observer.disconnect(); blur.dispose(); };
  }, [editor]);
  return room;
}

/** Monaco stores text with its own line endings, so compare text with all of them as `\n`. */
function sameText(a: string, b: string): boolean {
  return a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n');
}

const replacing = new WeakSet<CodeEditor>();

/**
 * Replacing the model's value clears its undo history, so undo cannot bring back another document's text (#183).
 * Equal text is not replaced, so a host that shows several documents in turn must give each its own editor (a React
 * key per document), or two with the same text share one undo history (#228).
 */
export function replaceExternalValue(editor: CodeEditor, value: string): boolean {
  if (sameText(editor.getValue(), value)) return false;
  replacing.add(editor);
  try {
    editor.getModel()?.setValue(value);
  } finally {
    replacing.delete(editor);
  }
  return true;
}

/** Monaco reports `setValue` as a content change and @monaco-editor/react passes it to `onChange`, so without this a host saw its own text come back as an edit (#228). */
export function isExternalReplace(editor: CodeEditor | null): boolean {
  return editor !== null && replacing.has(editor);
}

/** Pass the editor `defaultValue`, not `value`: @monaco-editor/react applies a new `value` as an undoable edit. */
export function useExternalValue(editor: CodeEditor | null, value: string): void {
  useEffect(() => {
    if (editor) replaceExternalValue(editor, value);
  }, [editor, value]);
}

export function revealProblem(editor: CodeEditor, problem: Problem): void {
  editor.setPosition({ lineNumber: problem.line, column: problem.column });
  editor.revealLineInCenter(problem.line);
  editor.focus();
}
