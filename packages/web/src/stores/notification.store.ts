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

// Lets the global mutation error toast and a call site's own coexist without
// showing the same message twice.
const DEDUPE_WINDOW_MS = 1500;
const recent = new Map<string, number>();

export const useNotificationStore = create<NotificationStore>((set) => ({
  notifications: [],

  notify: (message: string, severity: NotificationSeverity = 'info'): void => {
    const dedupeKey = `${severity}:${message}`;
    const now = Date.now();
    // Prune expired entries so the map stays bounded over a long-running session.
    for (const [key, ts] of recent) {
      if (now - ts >= DEDUPE_WINDOW_MS) recent.delete(key);
    }
    const last = recent.get(dedupeKey);
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) {
      return;
    }
    recent.set(dedupeKey, now);

    const id = nextId++;
    set((state) => ({
      notifications: [...state.notifications, { id, message, severity }],
    }));

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

export function useNotification(): { readonly notify: NotificationStore['notify'] } {
  const notify = useNotificationStore((state) => state.notify);
  return { notify };
}
