// ===========================================
// Unsupported Connector Placeholder
// ===========================================

import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface UnsupportedConnectorPlaceholderProps {
  readonly connectorType: string;
}

export function UnsupportedConnectorPlaceholder({ connectorType }: UnsupportedConnectorPlaceholderProps): ReactNode {
  return (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Typography color="text.secondary">
        {connectorType} connector settings are not yet available.
      </Typography>
    </Box>
  );
}
