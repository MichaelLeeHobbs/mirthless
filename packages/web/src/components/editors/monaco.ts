// The one place the app loads Monaco. Bundled, not from a CDN, so editors work without internet access and a
// Content-Security-Policy needs no CDN host; Monaco's inline styles need `style-src 'unsafe-inline'`, as MUI's do (D-283).

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';
import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js';
import { IStorageService } from 'monaco-editor/esm/vs/platform/storage/common/storage.js';
import { editorTheme, editorThemeName } from '../../styles/editor-theme.js';
import { SCRIPT_COMPILER_OPTIONS } from '@galvanigraph/core-models';
import { markSurfaceApplied, surfaceLibs, type SurfaceLibs } from './surface-state.js';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

// Suggestion docs open beside the list by default. Monaco keeps that toggle in its storage service (scope PROFILE = 0,
// target USER = 0), which exists once an editor does. 560px wide, not Monaco's 430, fits a code template's name and
// signature on its row; Monaco restores this size on each open, and the height is its default (12 rows of 20px plus the border).
StandaloneServices.withServices(() => {
  const storage = StandaloneServices.get(IStorageService);
  storage.store('expandSuggestionDocs', true, 0, 0);
  storage.store('suggestWidget.size/vs.editor.ICodeEditor/false', JSON.stringify({ width: 560, height: 242 }), 0, 1);
});

// With the documentation open by default, Ctrl+Space while the list is open
// would hide it (Monaco's toggle); a second Ctrl+Space is usually a habit, not a request.
monaco.editor.addKeybindingRule({ keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, command: '-toggleSuggestionDetails' });

// Monaco breaks the signature in the documentation panel at any letter
// ("message: s / tring"); break at spaces instead.
const popupStyle = document.createElement('style');
popupStyle.textContent = '.monaco-editor .suggest-details > .monaco-scrollable-element > .body > .header > .type.auto-wrap'
  + ' { word-break: normal; overflow-wrap: break-word; }';
document.head.append(popupStyle);

monaco.editor.defineTheme(editorThemeName('light'), editorTheme('light'));
monaco.editor.defineTheme(editorThemeName('dark'), editorTheme('dark'));

monaco.languages.register({ id: 'hl7' });
monaco.languages.setMonarchTokensProvider('hl7', {
  tokenizer: {
    root: [
      [/^[A-Z][A-Z0-9]{2}(?=\|)/, 'hl7.segment'],
      [/\\[A-Z0-9.]*\\/, 'hl7.escape'],
      [/[|^~&]/, 'hl7.delimiter'],
    ],
  },
});

// The same compiler settings as the server's deploy check.
const ts = monaco.typescript;
// The shared options hold TypeScript's numeric enum values; Monaco types them as
// its own enums, which have the same numbers.
const compilerOptions = {
  ...SCRIPT_COMPILER_OPTIONS, lib: [...SCRIPT_COMPILER_OPTIONS.lib],
} as unknown as monaco.typescript.CompilerOptions;
ts.typescriptDefaults.setCompilerOptions(compilerOptions);
// Monaco checks the script as the editor shows it, where a top-level `return`
// hides its expression from the type checker, so it reports syntax errors only.
// Type errors come from the script checked as the body of the function the
// engine runs it in (script-body-check.ts, #206).
ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
ts.javascriptDefaults.setCompilerOptions({ ...compilerOptions, allowJs: true, checkJs: false });
ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });

/**
 * Monaco keeps one set of globals for every editor, so the focused editor's surface wins and an editor with another
 * surface hides its type errors meanwhile (surface-state.ts); the deploy check repeats the check per script.
 */
export function applyScriptSurface(libs: SurfaceLibs): void {
  if (!markSurfaceApplied(libs.key)) return;
  const files = [...libs.files];
  ts.typescriptDefaults.setExtraLibs(files);
  ts.javascriptDefaults.setExtraLibs(files);
}
applyScriptSurface(surfaceLibs({}, []));

/**
 * Every editor's popups render here, at the end of <body>, so nothing around an editor can clip them; the class picks
 * up Monaco's theme variables. Fixed at the viewport origin: Monaco places popups in viewport coordinates, so an
 * absolute host at the document origin put them off by the page's scroll.
 */
export const overflowWidgetsHost: HTMLElement = (() => {
  const el = document.createElement('div');
  el.className = 'monaco-editor';
  el.setAttribute('data-editor-popups', '');
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '0';
  el.style.zIndex = '1500';
  document.body.append(el);
  return el;
})();

export { monaco };
