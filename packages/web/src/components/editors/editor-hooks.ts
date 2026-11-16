// ===========================================
// Editor hooks
// ===========================================

import { useEffect, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import { monaco, overflowWidgetsHost } from './monaco.js';
import { editorThemeName } from '../../styles/editor-theme.js';

type CodeEditor = monaco.editor.IStandaloneCodeEditor;

/** Monaco theme name that matches the app's current light/dark mode. */
export function useEditorTheme(): string {
  return editorThemeName(useTheme().palette.mode);
}

/** One problem in the editor, as shown in the status line. */
export interface Problem {
  readonly severity: 'error' | 'warning';
  /** Syntax (the code does not parse) or type (it parses but is wrong). */
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

/** Errors first, then by position. */
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

/** Live problems (errors and warnings) for the editor's model. */
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

/** Cursor line and column. */
export function useCursor(editor: CodeEditor | null): { readonly line: number; readonly column: number } {
  const [pos, setPos] = useState({ line: 1, column: 1 });
  useEffect(() => {
    if (!editor) return undefined;
    const sub = editor.onDidChangeCursorPosition((e) => { setPos({ line: e.position.lineNumber, column: e.position.column }); });
    return () => { sub.dispose(); };
  }, [editor]);
  return pos;
}

/**
 * The problems to report while the user may be mid-word. With the completion
 * list open, `logger.` is half typed, not wrong: the parser's syntax error at
 * the cursor is left out until the list closes. Everything else is kept.
 */
export function settledProblems(
  problems: readonly Problem[], cursor: { readonly line: number; readonly column: number }, completing: boolean,
): readonly Problem[] {
  if (!completing) return problems;
  return problems.filter((p) => !(p.kind === 'syntax' && p.line === cursor.line && Math.abs(p.column - cursor.column) <= 1));
}

/** Height an editor needs to hold the open completion list and its docs below the cursor line, or 0 when none is open. */
export function suggestRoom(host: HTMLElement): number {
  const list = host.querySelector<HTMLElement>('.suggest-widget.visible');
  if (!list) return 0;
  // The documentation panel opens beside the list and can be the taller of the two.
  const docs = host.querySelector<HTMLElement>('.suggest-details-container');
  return Math.max(list.offsetHeight, docs?.offsetHeight ?? 0) + 8;
}

/**
 * Room to add to a fit-to-content editor while its completion list is open, so
 * the list stays inside the editor instead of covering the status line below.
 * Completion renders in the shared popup host, so this watches the host and
 * answers only for the editor that has focus.
 */
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

/** The owner Monaco's TypeScript service sets its markers under (the language id). */
const TYPESCRIPT_MARKER_OWNER = 'typescript';

/** The markers that do not depend on the declarations: syntax errors. */
export function syntaxMarkers(markers: readonly monaco.editor.IMarker[]): monaco.editor.IMarker[] {
  return markers.filter((m) => problemKind(m.code) === 'syntax');
}

/**
 * While another editor's surface is applied (`stale`), TypeScript checks this
 * editor against declarations that are not its own: drop the type errors it
 * reports, keeping syntax errors, until this editor's surface is applied again.
 */
export function useStaleTypeMarkers(editor: CodeEditor | null, stale: boolean): void {
  useEffect(() => {
    if (!editor || !stale) return undefined;
    const strip = (): void => {
      const model = editor.getModel();
      if (!model) return;
      const markers = monaco.editor.getModelMarkers({ resource: model.uri, owner: TYPESCRIPT_MARKER_OWNER });
      const kept = syntaxMarkers(markers);
      if (kept.length !== markers.length) monaco.editor.setModelMarkers(model, TYPESCRIPT_MARKER_OWNER, kept);
    };
    strip();
    const sub = monaco.editor.onDidChangeMarkers((uris) => {
      const model = editor.getModel();
      if (model && uris.some((u) => u.toString() === model.uri.toString())) strip();
    });
    return () => { sub.dispose(); };
  }, [editor, stale]);
}

/** Monaco stores text with its own line endings, so compare text with all of them as `\n`. */
function sameText(a: string, b: string): boolean {
  return a.replace(/\r\n?/g, '\n') === b.replace(/\r\n?/g, '\n');
}

/**
 * Put text the host gave into the editor when it is not what the editor
 * holds. Replacing the model's value clears its undo history, so undo cannot
 * bring back the text of another list item or tab the editor showed before
 * (#183). Returns whether it replaced the text.
 */
export function replaceExternalValue(editor: CodeEditor, value: string): boolean {
  if (sameText(editor.getValue(), value)) return false;
  editor.getModel()?.setValue(value);
  return true;
}

/**
 * Keep the editor showing the host's value. Pass the editor `defaultValue`,
 * not `value`: @monaco-editor/react applies a new `value` as an undoable edit.
 */
export function useExternalValue(editor: CodeEditor | null, value: string): void {
  useEffect(() => {
    if (editor) replaceExternalValue(editor, value);
  }, [editor, value]);
}

/** Move the cursor to a problem and focus the editor. */
export function revealProblem(editor: CodeEditor, problem: Problem): void {
  editor.setPosition({ lineNumber: problem.line, column: problem.column });
  editor.revealLineInCenter(problem.line);
  editor.focus();
}
