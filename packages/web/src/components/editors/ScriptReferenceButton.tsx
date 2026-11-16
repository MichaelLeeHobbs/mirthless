// ===========================================
// Script reference button
// ===========================================
// A toolbar button that opens a searchable list of what the script can use
// (message variables, sandbox functions, code templates, map shortcuts) and
// inserts the chosen one at the cursor, with a placeholder per parameter.

import { type ReactNode, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import InputAdornment from '@mui/material/InputAdornment';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListSubheader from '@mui/material/ListSubheader';
import Popover from '@mui/material/Popover';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FunctionsIcon from '@mui/icons-material/Functions';
import SearchIcon from '@mui/icons-material/Search';
import type { ScriptSurface, TemplateSource } from '@galvanigraph/core-models';
import type { monaco } from './monaco.js';
import { scriptReference, type ReferenceEntry } from './script-reference.js';
import { EditorToolbarButton } from './EditorToolbarButton.js';
import { FONT_FAMILY_MONO } from '../../styles/tokens.js';

interface ScriptReferenceButtonProps {
  readonly editor: monaco.editor.IStandaloneCodeEditor | null;
  readonly surface: ScriptSurface;
  readonly templates: readonly TemplateSource[];
}

interface SnippetController { insert(template: string): void }

/** Insert an entry at the cursor as a snippet, so Tab moves through its parameters. */
function insertEntry(editor: monaco.editor.IStandaloneCodeEditor, entry: ReferenceEntry): void {
  editor.focus();
  const snippets = editor.getContribution('snippetController2') as SnippetController | null;
  if (snippets) {
    snippets.insert(entry.snippet);
    return;
  }
  editor.trigger('reference', 'type', { text: entry.name });
}

function matches(entry: ReferenceEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || entry.name.toLowerCase().includes(q) || entry.doc.toLowerCase().includes(q);
}

export function ScriptReferenceButton({ editor, surface, templates }: ScriptReferenceButtonProps): ReactNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const entries = useMemo(() => scriptReference(surface, templates), [surface, templates]);
  const shown = entries.filter((e) => matches(e, query));
  const groups = [...new Set(shown.map((e) => e.group))];

  return (
    <>
      <EditorToolbarButton
        icon={<FunctionsIcon fontSize="small" />}
        label="Reference"
        tooltip="Functions and variables a script can use"
        ariaHaspopup="dialog"
        onClick={(e) => { setAnchor(e.currentTarget); }}
      />
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => { setAnchor(null); setQuery(''); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { 'aria-label': 'Script reference', sx: { width: 440, maxWidth: 'calc(100vw - 32px)', maxHeight: 460, display: 'flex', flexDirection: 'column' } } }}
      >
        <Box sx={{ p: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            placeholder="Search functions, variables and code templates"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
            Click to insert at the cursor. Tab moves between the parameters.
          </Typography>
        </Box>
        <List dense disablePadding sx={{ overflowY: 'auto' }}>
          {groups.map((group) => (
            <li key={group}>
              <ul style={{ padding: 0 }}>
                <ListSubheader sx={{ lineHeight: '28px', bgcolor: 'background.paper' }}>{group}</ListSubheader>
                {shown.filter((e) => e.group === group).map((entry) => (
                  <ListItemButton
                    key={entry.name}
                    disabled={!editor}
                    onClick={() => {
                      if (editor) insertEntry(editor, entry);
                      setAnchor(null);
                      setQuery('');
                    }}
                    sx={{ display: 'block', py: 0.75 }}
                  >
                    <Typography component="div" sx={{ fontFamily: FONT_FAMILY_MONO, fontSize: 12.5, overflowWrap: 'anywhere' }}>
                      {entry.signatures[0]}
                      {entry.signatures.length > 1 ? (
                        <Box component="span" sx={{ color: 'text.secondary' }}> (+{entry.signatures.length - 1} overload)</Box>
                      ) : null}
                    </Typography>
                    {entry.doc ? (
                      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>{entry.doc}</Typography>
                    ) : null}
                  </ListItemButton>
                ))}
              </ul>
            </li>
          ))}
          {shown.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>Nothing matches "{query}".</Typography>
          ) : null}
        </List>
      </Popover>
    </>
  );
}
