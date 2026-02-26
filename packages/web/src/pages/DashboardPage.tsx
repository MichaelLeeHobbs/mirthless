import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';

export function DashboardPage(): ReactNode {
  return (
    <Box>
      <Typography variant="h4" component="h1" sx={{ mb: 3, fontWeight: 600 }}>
        Dashboard
      </Typography>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Welcome to Mirthless — Healthcare Integration Engine
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Channel status and statistics will appear here.
        </Typography>
      </Paper>
    </Box>
  );
}
