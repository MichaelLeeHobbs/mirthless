// ===========================================
// Script Editor
// ===========================================
// The editor for user scripts (filters, transformers, channel and global
// scripts, code templates): a language switch, format, full screen, and a status
// line with the cursor position and the script's problems.

import { type ReactNode, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import Editor from '@monaco-editor/react';
import { monaco } from './monaco.js';
import { EditorFrame } from './EditorFrame.js';
import { BASE_EDITOR_OPTIONS } from './editor-options.js';
import { useCursor, useEditorTheme, useProblems } from './editor-hooks.js';
import { ProblemStatus } from './ProblemStatus.js';

export type ScriptLanguage = 'javascript' | 'typescript';

const LANGUAGE_NAME: Readonly<Record<ScriptLanguage, string>> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
};

export interface ScriptEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Editor area height (CSS length or px). Defaults to 300px. */
  readonly height?: string | number;
  /** Names the editor for screen readers and the toolbar, e.g. "Deploy script". */
  readonly label?: string;
  /** Show the label in the toolbar. Off when the host already titles the editor. */
  readonly showLabel?: boolean;
  readonly language?: ScriptLanguage;
  readonly showLanguageToggle?: boolean;
  /** Fired when the user switches JavaScript/TypeScript, so the host can store it. */
  readonly onLanguageChange?: (language: ScriptLanguage) => void;
  /** View-only: the code and the language cannot be changed. */
  readonly readOnly?: boolean;
}

export function ScriptEditor({
  value,
  onChange,
  height = '300px',
  label = 'Script',
  showLabel = true,
  language: languageProp,
  showLanguageToggle = false,
  onLanguageChange,
  readOnly = false,
}: ScriptEditorProps): ReactNode {
  const theme = useEditorTheme();
  const [internalLang, setInternalLang] = useState<ScriptLanguage>('javascript');
  const language = languageProp ?? internalLang;
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [expanded, setExpanded] = useState(false);
  const problems = useProblems(editor);
  const cursor = useCursor(editor);

  const start = showLanguageToggle ? (
    <ToggleButtonGroup
      value={language}
      exclusive
      size="small"
      disabled={readOnly}
      aria-label="Script language"
      onChange={(_e, val: ScriptLanguage | null) => {
        if (val) { setInternalLang(val); onLanguageChange?.(val); }
      }}
      sx={{ '& .MuiToggleButton-root': { px: 1.25, py: 0.25, fontSize: '0.75rem', textTransform: 'none' } }}
    >
      <ToggleButton value="javascript" aria-label="JavaScript">JavaScript</ToggleButton>
      <ToggleButton value="typescript" aria-label="TypeScript">TypeScript</ToggleButton>
    </ToggleButtonGroup>
  ) : null;

  const end = (
    <>
      {readOnly ? <Chip size="small" variant="outlined" label="Read only" /> : null}
      {!readOnly ? (
        <Tooltip title="Format document (Shift+Alt+F)">
          <span>
            <IconButton
              size="small"
              aria-label="Format document"
              disabled={!editor}
              onClick={() => { void editor?.getAction('editor.action.formatDocument')?.run(); }}
            >
              <FormatAlignLeftIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      ) : null}
    </>
  );

  return (
    <EditorFrame
      label={label}
      showLabel={showLabel}
      start={start}
      end={end}
      height={height}
      expanded={expanded}
      onExpandedChange={setExpanded}
      status={
        <>
          <ProblemStatus editor={editor} problems={problems} />
          <Box sx={{ flexGrow: 1 }} />
          <span>Ln {cursor.line}, Col {cursor.column}</span>
          <span>{LANGUAGE_NAME[language]}</span>
        </>
      }
    >
      <Editor
        height="100%"
        language={language}
        theme={theme}
        value={value}
        onChange={(v) => { onChange(v ?? ''); }}
        onMount={(ed) => { setEditor(ed); }}
        options={{ ...BASE_EDITOR_OPTIONS, readOnly, ariaLabel: label, autoClosingBrackets: 'always', formatOnPaste: true }}
      />
    </EditorFrame>
  );
}
