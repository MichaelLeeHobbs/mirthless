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
import {
  IGNORED_SCRIPT_DIAGNOSTICS, SCRIPT_COMPILER_OPTIONS, scriptDeclarations, templateDeclarations,
  type ScriptSurface, type TemplateSource,
} from '@galvaniflow/core-models';

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

// TypeScript scripts get full type checking with the same settings as the
// server's deploy check. JavaScript scripts get syntax errors only, plus the
// same completion and hover.
const ts = monaco.typescript;
// The shared options hold TypeScript's numeric enum values; Monaco types them as
// its own enums, which have the same numbers.
const compilerOptions = {
  ...SCRIPT_COMPILER_OPTIONS, lib: [...SCRIPT_COMPILER_OPTIONS.lib],
} as unknown as monaco.typescript.CompilerOptions;
ts.typescriptDefaults.setCompilerOptions(compilerOptions);
ts.typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false, noSyntaxValidation: false, diagnosticCodesToIgnore: [...IGNORED_SCRIPT_DIAGNOSTICS],
});
ts.javascriptDefaults.setCompilerOptions({ ...compilerOptions, allowJs: true, checkJs: false });
ts.javascriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: true, noSyntaxValidation: false, diagnosticCodesToIgnore: [...IGNORED_SCRIPT_DIAGNOSTICS],
});

let appliedLibs = '';

/**
 * Give the TypeScript service the globals for one script surface: the sandbox
 * (msg typed by data type, destinationSet where it exists) and the code
 * templates the script can call. Monaco keeps one set for every editor, so the
 * focused editor's surface wins; the deploy check repeats the check per script.
 */
export function applyScriptSurface(surface: ScriptSurface, templates: readonly TemplateSource[]): void {
  const sandbox = scriptDeclarations(surface);
  const library = templateDeclarations(templates, surface);
  const key = `${sandbox}\u0000${library}`;
  if (key === appliedLibs) return;
  appliedLibs = key;
  const libs = [
    { content: sandbox, filePath: 'file:///sandbox.d.ts' },
    { content: library, filePath: 'file:///code-templates.d.ts' },
  ];
  ts.typescriptDefaults.setExtraLibs(libs);
  ts.javascriptDefaults.setExtraLibs(libs);
}
applyScriptSurface({}, []);

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
