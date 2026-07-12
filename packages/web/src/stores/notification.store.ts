// ===========================================
// Notification Store
// ===========================================
// Centralized Zustand store for app-wide snackbar notifications.

import { create } from 'zustand';

type NotificationSeverity = 'success' | 'error' | 'warning' | 'info';

interface Notification {
  readonly id: number;
  readonly message: string;
  readonly severity: NotificationSeverity;
}

interface NotificationState {
  readonly notifications: readonly Notification[];
}

interface NotificationActions {
  readonly notify: (message: string, severity?: NotificationSeverity) => void;
  readonly dismiss: (id: number) => void;
}

type NotificationStore = NotificationState & NotificationActions;

let nextId = 1;

// Dedupe window: identical message+severity within this window is collapsed to a
// single toast. This lets the global mutation error handler and a call-site's own
// error toast coexist without showing the same message twice.
const DEDUPE_WINDOW_MS = 1500;
const recent = new Map<string, number>();

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  notify: (message: string, severity: NotificationSeverity = 'info'): void => {
    const dedupeKey = `${severity}:${message}`;
    const now = Date.now();
    const last = recent.get(dedupeKey);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
      return;
    }
    recent.set(dedupeKey, now);

    const id = nextId++;
    set((state) => ({
      notifications: [...state.notifications, { id, message, severity }],
    }));

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    }, 4000);
  },

  dismiss: (id: number): void => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
}));

/** Convenience hook for notification actions. */
export function useNotification(): { readonly notify: NotificationStore['notify'] } {
  const notify = useNotificationStore((state) => state.notify);
  return { notify };
}
