// ===========================================
// About Dialog
// ===========================================
// Shows the application name and version.

import { type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';

interface AboutDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

// Injected by Vite (see vite.config.ts). Guarded so importing this in a bare
// test environment without the define does not throw a ReferenceError.
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

export function AboutDialog({ open, onClose }: AboutDialogProps): ReactNode {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>About Mirthless</DialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'primary.main' }}>
            Mirthless
          </Typography>
          <Typography variant="body2" color="text.secondary">
            A modern, open-source healthcare integration engine.
          </Typography>
          <Typography variant="body2">
            Version <strong>{APP_VERSION}</strong>
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
