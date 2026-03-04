// ===========================================
// Keyboard Shortcut Help Dialog
// ===========================================
// Shows available keyboard shortcuts.

import type { ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import Kbd from '@mui/material/Chip';

interface ShortcutEntry {
  readonly keys: string;
  readonly description: string;
}

const SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: '?', description: 'Show this help dialog' },
  { keys: 'g d', description: 'Go to Dashboard' },
  { keys: 'g c', description: 'Go to Channels' },
  { keys: 'g s', description: 'Go to Settings' },
  { keys: 'g a', description: 'Go to Alerts' },
  { keys: 'g u', description: 'Go to Users' },
  { keys: 'Esc', description: 'Close dialog' },
];

interface KeyboardShortcutHelpProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function KeyboardShortcutHelp({ open, onClose }: KeyboardShortcutHelpProps): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Keyboard Shortcuts</DialogTitle>
      <DialogContent>
        <Table size="small">
          <TableBody>
            {SHORTCUTS.map((s) => (
              <TableRow key={s.keys}>
                <TableCell sx={{ width: 100, border: 0 }}>
                  {s.keys.split(' ').map((k) => (
                    <Kbd
                      key={k}
                      label={k}
                      size="small"
                      variant="outlined"
                      sx={{ mr: 0.5, fontFamily: 'monospace', fontSize: '0.75rem' }}
                    />
                  ))}
                </TableCell>
                <TableCell sx={{ border: 0 }}>
                  <Typography variant="body2">{s.description}</Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
