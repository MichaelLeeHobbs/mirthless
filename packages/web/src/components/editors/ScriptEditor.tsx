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

type ScriptLanguage = 'javascript' | 'typescript';

interface ScriptEditorProps {
  readonly height: string;
  readonly value: string;
  readonly onChange: (value: string | undefined) => void;
  readonly language?: ScriptLanguage;
  readonly showLanguageToggle?: boolean;
}

let jsTypesRegistered = false;
let tsTypesRegistered = false;

function registerJsDefaults(monaco: Parameters<BeforeMount>[0]): void {
  if (jsTypesRegistered) return;

  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    allowJs: true,
    checkJs: false,
  });

  monaco.languages.typescript.javascriptDefaults.addExtraLib(
    SANDBOX_TYPE_DEFS,
    'file:///sandbox-globals.d.ts',
  );

  jsTypesRegistered = true;
}

function registerTsDefaults(monaco: Parameters<BeforeMount>[0]): void {
  if (tsTypesRegistered) return;

  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  });

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    strict: true,
  });

  monaco.languages.typescript.typescriptDefaults.addExtraLib(
    SANDBOX_TYPE_DEFS,
    'file:///sandbox-globals.d.ts',
  );

  tsTypesRegistered = true;
}

export function ScriptEditor({
  height,
  value,
  onChange,
  language: languageProp,
  showLanguageToggle = false,
}: ScriptEditorProps): ReactNode {
  const themeMode = useUiStore((state) => state.themeMode);
  const monacoTheme = themeMode === 'dark' ? 'vs-dark' : 'vs';

  const [internalLang, setInternalLang] = useState<ScriptLanguage>('javascript');
  const language = languageProp ?? internalLang;

  const handleBeforeMount: BeforeMount = (monaco) => {
    registerJsDefaults(monaco);
    registerTsDefaults(monaco);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height }}>
      {showLanguageToggle ? (
        <Box sx={{ display: 'flex', alignItems: 'center', px: 1, py: 0.5 }}>
          <ToggleButtonGroup
            value={language}
            exclusive
            onChange={(_e, val: ScriptLanguage | null) => {
              if (val) setInternalLang(val);
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
