// ===========================================
// RequirePermission Route Guard
// ===========================================
// Blocks route access when the user lacks the required permission(s).
// Renders a "not authorized" notice instead of the page so a viewer cannot
// reach admin screens by typing the URL directly.

import { type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import { usePermissions } from '../../hooks/use-permissions.js';
import type { PermissionString } from '../../lib/permissions.js';

interface RequirePermissionProps {
  /** User must hold at least one of these permissions to view the route. */
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
