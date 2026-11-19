// Render only while the form has unsaved changes, so a clean form shows no disabled Save button.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

interface UnsavedChangesBarProps {
  readonly count: number;
  readonly saving: boolean;
  readonly blockedReason?: string | null;
  readonly onDiscard: () => void;
  readonly onSave: () => void;
}

export function UnsavedChangesBar({ count, saving, blockedReason, onDiscard, onSave }: UnsavedChangesBarProps): ReactNode {
  const label = blockedReason ?? `${count} unsaved ${count === 1 ? 'change' : 'changes'}`;
  return (
    <Paper
      role="region"
      aria-label="Unsaved changes"
      sx={{
        position: 'sticky',
        bottom: 16,
        zIndex: 2,
        mt: 2,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1,
        py: 1.25,
        px: 2,
        borderColor: 'primary.main',
        bgcolor: 'surfaceRaised',
      }}
    >
      <Typography variant="body2" sx={{ flex: 1, flexBasis: { xs: '100%', sm: 'auto' }, fontWeight: 600, color: blockedReason ? 'error.main' : 'text.primary' }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
        <Button variant="outlined" onClick={onDiscard} disabled={saving}>Discard</Button>
        <Button variant="contained" onClick={onSave} disabled={saving || Boolean(blockedReason)}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </Box>
    </Paper>
  );
}
