// ===========================================
// Test Connection Button
// ===========================================
// Reusable button that tests connector connectivity and shows result.

import { type ReactNode } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useTestConnection } from '../../hooks/use-connection-test.js';

interface TestConnectionButtonProps {
  readonly connectorType: string;
  readonly mode: 'SOURCE' | 'DESTINATION';
  readonly properties: Record<string, unknown>;
}

export function TestConnectionButton({ connectorType, mode, properties }: TestConnectionButtonProps): ReactNode {
  const testMutation = useTestConnection();

  const handleTest = (): void => {
    testMutation.mutate({ connectorType, mode, properties });
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
      <Button
        variant="outlined"
        size="small"
        startIcon={testMutation.isPending ? <CircularProgress size={16} /> : <WifiTetheringIcon />}
        onClick={handleTest}
        disabled={testMutation.isPending}
      >
        {testMutation.isPending ? 'Testing...' : 'Test Connection'}
      </Button>
      {testMutation.isSuccess ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {testMutation.data.success ? (
            <>
              <CheckCircleIcon color="success" fontSize="small" />
              <Typography variant="body2" color="success.main">
                Connected ({String(testMutation.data.latencyMs)}ms)
              </Typography>
            </>
          ) : (
            <>
              <ErrorIcon color="error" fontSize="small" />
              <Typography variant="body2" color="error.main">
                {testMutation.data.message}
              </Typography>
            </>
          )}
        </Box>
      ) : null}
      {testMutation.isError ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <ErrorIcon color="error" fontSize="small" />
          <Typography variant="body2" color="error.main">
            {testMutation.error.message}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}
