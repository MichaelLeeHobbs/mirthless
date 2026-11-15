// ===========================================
// Monaco setup
// ===========================================
// The one place the app loads Monaco. It is bundled (no CDN), so editors work on
// networks with no internet access and under a strict Content-Security-Policy.
// Importing this module configures @monaco-editor/react to use the bundle.

import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker';
import { editorTheme, editorThemeName } from '../../styles/editor-theme.js';
import { SANDBOX_TYPE_DEFS } from '../../lib/sandbox-types.js';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

monaco.editor.defineTheme(editorThemeName('light'), editorTheme('light'));
monaco.editor.defineTheme(editorThemeName('dark'), editorTheme('dark'));

// HL7 v2: segment names, delimiters and escape sequences.
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

const ts = monaco.typescript;
ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
ts.javascriptDefaults.setCompilerOptions({ target: ts.ScriptTarget.ES2020, allowNonTsExtensions: true, allowJs: true, checkJs: false });
ts.javascriptDefaults.addExtraLib(SANDBOX_TYPE_DEFS, 'file:///sandbox-globals.d.ts');
ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: false });
ts.typescriptDefaults.setCompilerOptions({ target: ts.ScriptTarget.ES2020, allowNonTsExtensions: true, strict: true });
ts.typescriptDefaults.addExtraLib(SANDBOX_TYPE_DEFS, 'file:///sandbox-globals.d.ts');

/**
 * Where every editor renders its popups (completion, hover, parameter hints).
 * It sits at the end of <body>, so no card, accordion or dialog around an
 * editor can clip them. The class picks up Monaco's theme variables.
 */
export const overflowWidgetsHost: HTMLElement = (() => {
  const el = document.createElement('div');
  el.className = 'monaco-editor';
  el.setAttribute('data-editor-popups', '');
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.zIndex = '1500';
  document.body.append(el);
  return el;
})();

export { monaco };
