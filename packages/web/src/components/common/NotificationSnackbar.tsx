// ===========================================
// Notification Snackbar
// ===========================================
// Global snackbar component that reads from the notification store.
// Renders one snackbar at a time (the latest notification).

import type { ReactNode } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { useNotificationStore } from '../../stores/notification.store.js';

export function NotificationSnackbar(): ReactNode {
  const notifications = useNotificationStore((state) => state.notifications);
  const dismiss = useNotificationStore((state) => state.dismiss);

  const current = notifications[0];

  if (!current) return null;

  return (
    <Snackbar
      open
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      onClose={() => { dismiss(current.id); }}
    >
      <Alert
        onClose={() => { dismiss(current.id); }}
        severity={current.severity}
        variant="filled"
      >
        {current.message}
      </Alert>
    </Snackbar>
  );
}
