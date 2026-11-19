import { type ReactNode, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { DiffEditor } from '@monaco-editor/react';
import { EditorFrame } from './EditorFrame.js';
import { BASE_EDITOR_OPTIONS } from './editor-options.js';
import { useEditorTheme } from './editor-hooks.js';
import type { TextLanguage } from './TextEditor.js';

export interface CodeDiffEditorProps {
  readonly original: string;
  readonly modified: string;
  readonly originalLabel: string;
  readonly modifiedLabel: string;
  readonly label: string;
  readonly language?: TextLanguage;
  readonly height?: string | number;
}

export function CodeDiffEditor({
  original, modified, originalLabel, modifiedLabel, label, language = 'json', height = '60vh',
}: CodeDiffEditorProps): ReactNode {
  const theme = useEditorTheme();
  const [expanded, setExpanded] = useState(false);
  const [changes, setChanges] = useState<number | null>(null);

  return (
    <EditorFrame
      label={label}
      showLabel={false}
      height={height}
      expanded={expanded}
      onExpandedChange={setExpanded}
      start={
        // Outgrows the toolbar spacer, so each label sits over its own pane.
        <Box sx={{ display: 'flex', flex: '1000 1 0', minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 600, pl: 0.5 }}>{originalLabel}</Typography>
          <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: 600, pl: 1 }}>{modifiedLabel}</Typography>
        </Box>
      }
      status={
        <span>
          {changes === null ? 'Comparing…' : changes === 0 ? 'No differences' : `${String(changes)} ${changes === 1 ? 'change' : 'changes'}`}
        </span>
      }
    >
      <DiffEditor
        height="100%"
        language={language}
        theme={theme}
        original={original}
        modified={modified}
        onMount={(ed) => {
          const count = (): void => { setChanges(ed.getLineChanges()?.length ?? null); };
          ed.onDidUpdateDiff(count);
        }}
        options={{ ...BASE_EDITOR_OPTIONS, readOnly: true, renderSideBySide: true, ariaLabel: label }}
      />
    </EditorFrame>
  );
}
