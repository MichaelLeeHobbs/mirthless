// ===========================================
// Script Editor
// ===========================================
// Wrapper around Monaco Editor with sandbox type definitions for IntelliSense.

import type { ReactNode } from 'react';
import Editor, { type BeforeMount } from '@monaco-editor/react';
import { SANDBOX_TYPE_DEFS } from '../../lib/sandbox-types.js';

interface ScriptEditorProps {
  readonly height: string;
  readonly value: string;
  readonly onChange: (value: string | undefined) => void;
}

let typesRegistered = false;

const handleBeforeMount: BeforeMount = (monaco) => {
  if (!typesRegistered) {
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

    typesRegistered = true;
  }
};

export function ScriptEditor({ height, value, onChange }: ScriptEditorProps): ReactNode {
  return (
    <Editor
      height={height}
      language="javascript"
      theme="vs-dark"
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
      }}
    />
  );
}
