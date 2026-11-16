// A fake Monaco for tests that need the editor to behave: focus, typing, undo,
// the host replacing its text, and which surface the type service holds.
// Monaco cannot run in jsdom (test/setup.ts stubs it to render nothing). Use it
// from a test file with:
//   vi.mock('<path>/editors/monaco.js', async () => (await import('<path>/fake-monaco.js')).fakeMonacoModule());
//   vi.mock('@monaco-editor/react', async () => (await import('<path>/fake-monaco.js')).fakeMonacoReact);

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { markSurfaceApplied, type SurfaceLibs } from '../surface-state.js';

interface Disposable { readonly dispose: () => void }

function listen(set: Set<() => void>, listener: () => void): Disposable {
  set.add(listener);
  return { dispose: () => { set.delete(listener); } };
}

const NONE: Disposable = { dispose: () => undefined };

/** One editor: its text, its undo history and its focus. */
export class FakeCodeEditor {
  /** Every editor mounted and not yet disposed, in mount order. */
  static readonly mounted: FakeCodeEditor[] = [];

  private text: string;
  private undoStack: string[] = [];
  private version = 1;
  private focused = false;
  private disposed = false;
  private readonly content = new Set<() => void>();
  private readonly focusListeners = new Set<() => void>();
  private readonly blurListeners = new Set<() => void>();

  readonly model = {
    uri: { toString: (): string => `file:///fake/${this.label}` },
    getValue: (): string => this.text,
    // As Monaco's: replaces the text, clears the undo history, fires a change.
    setValue: (value: string): void => { this.undoStack = []; this.change(value); },
    getVersionId: (): number => this.version,
    isDisposed: (): boolean => this.disposed,
    onDidChangeContent: (listener: () => void): Disposable => listen(this.content, listener),
  };

  /** The editor's aria label, which follows the host's options, as Monaco's does. */
  constructor(initial: string, public label: string) {
    this.text = initial;
  }

  private change(value: string): void {
    this.text = value;
    this.version += 1;
    for (const listener of [...this.content]) listener();
  }

  /** The user types: the edit can be undone. */
  type(value: string): void {
    this.undoStack.push(this.text);
    this.change(value);
  }

  /** Ctrl+Z. */
  undo(): void {
    const previous = this.undoStack.pop();
    if (previous !== undefined) this.change(previous);
  }

  /** The user clicks in: every other editor loses focus first. */
  focus(): void {
    for (const other of FakeCodeEditor.mounted) if (other !== this) other.blur();
    if (this.focused) return;
    this.focused = true;
    for (const listener of [...this.focusListeners]) listener();
  }

  blur(): void {
    if (!this.focused) return;
    this.focused = false;
    for (const listener of [...this.blurListeners]) listener();
  }

  dispose(): void {
    this.disposed = true;
    this.focused = false;
    const i = FakeCodeEditor.mounted.indexOf(this);
    if (i >= 0) FakeCodeEditor.mounted.splice(i, 1);
  }

  getModel(): FakeCodeEditor['model'] { return this.model; }
  getValue(): string { return this.text; }
  hasTextFocus(): boolean { return this.focused; }
  onDidFocusEditorText(listener: () => void): Disposable { return listen(this.focusListeners, listener); }
  onDidBlurEditorText(listener: () => void): Disposable { return listen(this.blurListeners, listener); }
  onDidChangeModelContent(listener: () => void): Disposable { return listen(this.content, listener); }
  onDidChangeCursorPosition(): Disposable { return NONE; }
  onDidChangeModel(): Disposable { return NONE; }
  onDidContentSizeChange(): Disposable { return NONE; }
  getContentHeight(): number { return 100; }
  addAction(): Disposable { return NONE; }
  getAction(): undefined { return undefined; }
  setPosition(): void { /* no cursor here */ }
  revealLineInCenter(): void { /* no scrolling here */ }
}

/** The mounted editor with this label (the ScriptEditor `label`). */
export function fakeEditor(label: string): FakeCodeEditor {
  const found = FakeCodeEditor.mounted.find((e) => e.label === label);
  if (!found) throw new Error(`No editor labelled "${label}" is mounted`);
  return found;
}

/** Every surface applied to the type service, in order (only real changes, as Monaco's). */
export const appliedSurfaces: SurfaceLibs[] = [];

const fakeMonaco = {
  MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
  KeyMod: { CtrlCmd: 2048 },
  KeyCode: { Enter: 3 },
  Uri: { parse: (s: string) => ({ toString: () => s }) },
  editor: {
    getModelMarkers: (): [] => [],
    onDidChangeMarkers: (): Disposable => NONE,
    setModelMarkers: (): void => undefined,
    getEditors: (): FakeCodeEditor[] => [...FakeCodeEditor.mounted],
    createModel: (_text: string, _language: string, uri: unknown) => ({
      uri, setValue: (): void => undefined, getPositionAt: () => ({ lineNumber: 1, column: 1 }), dispose: (): void => undefined,
    }),
  },
  typescript: {
    getTypeScriptWorker: async () => async () => ({ getSemanticDiagnostics: async (): Promise<[]> => [] }),
    typescriptDefaults: { onDidExtraLibsChange: (): Disposable => NONE },
  },
};

/** Stands in for `components/editors/monaco.ts`, with the real applied-surface tracking. */
export function fakeMonacoModule(): Record<string, unknown> {
  return {
    monaco: fakeMonaco,
    overflowWidgetsHost: document.createElement('div'),
    applyScriptSurface: (libs: SurfaceLibs): void => { if (markSurfaceApplied(libs.key)) appliedSurfaces.push(libs); },
  };
}

interface FakeEditorProps {
  readonly defaultValue?: string;
  readonly onChange?: (value: string | undefined) => void;
  readonly onMount?: (editor: never) => void;
  readonly options?: { readonly ariaLabel?: string };
}

/** @monaco-editor/react's Editor: forwards every content change to `onChange`, as 4.7.0 does. */
function FakeEditor({ defaultValue = '', onChange, onMount, options }: FakeEditorProps): ReactNode {
  const [editor] = useState(() => new FakeCodeEditor(defaultValue, options?.ariaLabel ?? ''));
  const latest = useRef({ onChange, onMount });
  latest.current = { onChange, onMount };
  editor.label = options?.ariaLabel ?? '';
  useEffect(() => {
    FakeCodeEditor.mounted.push(editor);
    const sub = editor.onDidChangeModelContent(() => { latest.current.onChange?.(editor.getValue()); });
    latest.current.onMount?.(editor as never);
    return () => { sub.dispose(); editor.dispose(); };
  }, [editor]);
  return null;
}

/** Stands in for `@monaco-editor/react`. */
export const fakeMonacoReact = {
  default: FakeEditor,
  DiffEditor: (): null => null,
  loader: { config: (): void => undefined },
};
