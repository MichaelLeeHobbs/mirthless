// ===========================================
// Text Editor
// ===========================================
// The editor for message text (HL7, JSON, plain text): same frame as the
// script editor, with copy and full screen, and a line/character count.

import { type ReactNode, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import Editor from '@monaco-editor/react';
import type { monaco } from './monaco.js';
import { EditorFrame } from './EditorFrame.js';
import { BASE_EDITOR_OPTIONS } from './editor-options.js';
import { useCursor, useEditorTheme } from './editor-hooks.js';

export type TextLanguage = 'plaintext' | 'hl7' | 'json';

const LANGUAGE_NAME: Readonly<Record<TextLanguage, string>> = {
  plaintext: 'Plain text',
  hl7: 'HL7 v2',
  json: 'JSON',
};

export interface TextEditorProps {
  readonly value: string;
  /** Omit for a read-only view. */
  readonly onChange?: (value: string) => void;
  readonly label: string;
  readonly showLabel?: boolean;
  readonly language?: TextLanguage;
  readonly height?: string | number;
  readonly lineNumbers?: boolean;
}

export function TextEditor({
  value, onChange, label, showLabel = true, language = 'plaintext', height = '300px', lineNumbers = true,
}: TextEditorProps): ReactNode {
  const theme = useEditorTheme();
  const readOnly = onChange === undefined;
  const [editor, setEditor] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const cursor = useCursor(editor);
  const lines = value === '' ? 0 : value.split(/\r\n|\r|\n/).length;

  const copy = (): void => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); }, 1500);
    });
  };

  return (
    <EditorFrame
      label={label}
      showLabel={showLabel}
      height={height}
      expanded={expanded}
      onExpandedChange={setExpanded}
      end={
        <>
          {readOnly ? <Chip size="small" variant="outlined" label="Read only" /> : null}
          <Tooltip title={copied ? 'Copied' : 'Copy to clipboard'}>
            <IconButton size="small" aria-label="Copy to clipboard" onClick={copy} disabled={value === ''}>
              {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </>
      }
      status={
        <>
          <span>{lines} {lines === 1 ? 'line' : 'lines'}, {value.length.toLocaleString()} characters</span>
          <Box sx={{ flexGrow: 1 }} />
          {readOnly ? null : <span>Ln {cursor.line}, Col {cursor.column}</span>}
          <span>{LANGUAGE_NAME[language]}</span>
        </>
      }
    >
      <Editor
        height="100%"
        language={language}
        theme={theme}
        value={value}
        onChange={(v) => { onChange?.(v ?? ''); }}
        onMount={(ed) => { setEditor(ed); }}
        options={{ ...BASE_EDITOR_OPTIONS, readOnly, ariaLabel: label, lineNumbers: lineNumbers ? 'on' : 'off' }}
      />
    </EditorFrame>
  );
}
