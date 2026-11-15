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

/** Height an editor needs to hold the open completion list below the cursor line, or 0 when none is open. */
export function suggestRoom(host: HTMLElement): number {
  const list = host.querySelector<HTMLElement>('.suggest-widget.visible');
  return list ? list.offsetHeight + 8 : 0;
}

/**
 * Room to add to a fit-to-content editor while its completion list is open, so
 * the list stays inside the editor instead of covering the status line below.
 * Completion renders in the shared popup host, so this watches the host and
 * answers only for the editor that has focus.
 */
export function useSuggestRoom(editor: CodeEditor | null, enabled: boolean): number {
  const [room, setRoom] = useState(0);
  useEffect(() => {
    if (!editor || !enabled) return undefined;
    const update = (): void => { setRoom(editor.hasTextFocus() ? suggestRoom(overflowWidgetsHost) : 0); };
    const observer = new MutationObserver(update);
    observer.observe(overflowWidgetsHost, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    const blur = editor.onDidBlurEditorText(() => { setRoom(0); });
    return () => { observer.disconnect(); blur.dispose(); };
  }, [editor, enabled]);
  return room;
}

/** Move the cursor to a problem and focus the editor. */
export function revealProblem(editor: CodeEditor, problem: Problem): void {
  editor.setPosition({ lineNumber: problem.line, column: problem.column });
  editor.revealLineInCenter(problem.line);
  editor.focus();
}
