import { type ReactNode } from 'react';
import { Outlet } from 'react-router';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { usePermissions } from '../../hooks/use-permissions.js';
import type { PermissionString } from '../../lib/permissions.js';

interface RequirePermissionProps {
  readonly anyOf: readonly PermissionString[];
}

export function RequirePermission({ anyOf }: RequirePermissionProps): ReactNode {
  const { hasAny } = usePermissions();

  if (!hasAny(anyOf)) {
    return (
      <Box sx={{ maxWidth: 640, mx: 'auto', mt: 4 }}>
        <Alert severity="warning">
          <AlertTitle>Not authorized</AlertTitle>
          You do not have permission to view this page. Contact an administrator
          if you believe this is a mistake.
        </Alert>
      </Box>
    );
  }

  return <Outlet />;
}
