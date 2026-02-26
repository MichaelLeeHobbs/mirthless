// ===========================================
// Placeholder Tab
// ===========================================
// Shown for unimplemented editor tabs.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface PlaceholderTabProps {
  readonly label: string;
}

export function PlaceholderTab({ label }: PlaceholderTabProps): ReactNode {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
      <Typography variant="body1" color="text.secondary">
        {label} — coming soon
      </Typography>
    </Box>
  );
}
