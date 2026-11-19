import { vi } from 'vitest';

// Monaco cannot run in jsdom (it needs real layout and web workers). Components
// that contain an editor still render: the editor itself stays on its loading
// placeholder, and the toolbar, status line and host around it are testable.
vi.mock('../src/components/editors/monaco.ts', () => ({
  monaco: {
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {},
  },
  overflowWidgetsHost: document.createElement('div'),
  applyScriptSurface: (): void => undefined,
}));
vi.mock('@monaco-editor/react', () => ({
  default: (): null => null,
  DiffEditor: (): null => null,
  loader: { config: (): void => undefined },
}));
