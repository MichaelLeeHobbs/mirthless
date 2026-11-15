// ===========================================
// Script Editor
// ===========================================
// Wrapper around Monaco Editor with sandbox type definitions for IntelliSense.
// Supports JavaScript and TypeScript languages, syncs with app theme.

import { type ReactNode, useState } from 'react';
import Box from '@mui/material/Box';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Editor, { type BeforeMount } from '@monaco-editor/react';
import { SANDBOX_TYPE_DEFS } from '../../lib/sandbox-types.js';
import { useUiStore } from '../../stores/ui.store.js';

export type ScriptLanguage = 'javascript' | 'typescript';

interface ScriptEditorProps {
  readonly height: string;
  readonly value: string;
  readonly onChange: (value: string | undefined) => void;
  readonly language?: ScriptLanguage;
  readonly showLanguageToggle?: boolean;
  /** Fired when the user toggles JS/TS, so the parent can persist the choice. */
  readonly onLanguageChange?: (language: ScriptLanguage) => void;
  /** View-only: the code and the JS/TS toggle cannot be changed. */
  readonly readOnly?: boolean;
}

type LanguageDefaults = Parameters<BeforeMount>[0]['languages']['typescript']['javascriptDefaults'];
type CompilerOptions = Parameters<LanguageDefaults['setCompilerOptions']>[0];

/** Languages whose Monaco defaults are already set; Monaco keeps them for the page's lifetime. */
const registeredLanguages = new Set<ScriptLanguage>();

/** Sets diagnostics, compiler options and the sandbox type lib for one language, once per page load. */
function registerDefaults(
  language: ScriptLanguage,
  defaults: LanguageDefaults,
  compilerOptions: CompilerOptions,
): void {
  if (registeredLanguages.has(language)) return;

  defaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });
  defaults.setCompilerOptions(compilerOptions);
  defaults.addExtraLib(SANDBOX_TYPE_DEFS, 'file:///sandbox-globals.d.ts');

  registeredLanguages.add(language);
}

export function ScriptEditor({
  height,
  value,
  onChange,
  language: languageProp,
  showLanguageToggle = false,
  onLanguageChange,
  readOnly = false,
}: ScriptEditorProps): ReactNode {
  const themeMode = useUiStore((state) => state.themeMode);
  const monacoTheme = themeMode === 'dark' ? 'vs-dark' : 'vs';

  const [internalLang, setInternalLang] = useState<ScriptLanguage>('javascript');
  const language = languageProp ?? internalLang;

  const handleBeforeMount: BeforeMount = (monaco) => {
    const { typescript } = monaco.languages;
    registerDefaults('javascript', typescript.javascriptDefaults, {
      target: typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
    });
    registerDefaults('typescript', typescript.typescriptDefaults, {
      target: typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      strict: true,
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height }}>
      {showLanguageToggle ? (
        <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5 }}>
          <ToggleButtonGroup
            value={language}
            exclusive
            disabled={readOnly}
            onChange={(_e, val: ScriptLanguage | null) => {
              if (val) {
                setInternalLang(val);
                onLanguageChange?.(val);
              }
            }}
            size="small"
          >
            <ToggleButton value="javascript" sx={{ px: 1.5, py: 0.25, fontSize: '0.75rem' }}>
              JS
            </ToggleButton>
            <ToggleButton value="typescript" sx={{ px: 1.5, py: 0.25, fontSize: '0.75rem' }}>
              TS
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      ) : null}
      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <Editor
          height="100%"
          language={language}
          theme={monacoTheme}
          value={value}
          onChange={onChange}
          beforeMount={handleBeforeMount}
          options={{
            minimap: { enabled: false },
            readOnly,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            fontSize: 13,
            tabSize: 2,
            wordWrap: 'on',
            bracketPairColorization: { enabled: true },
            autoClosingBrackets: 'always',
            formatOnPaste: true,
          }}
        />
      </Box>
    </Box>
  );
}
