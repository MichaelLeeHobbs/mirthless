// ===========================================
// Dashboard Column Visibility (per-user)
// ===========================================
// Persists which dashboard columns a user has visible, via the user-preferences
// API. Keeps a local optimistic copy so toggling is instant.

import { useCallback, useMemo, useState } from 'react';
import { usePreferences, useUpsertPreference } from './use-preferences.js';
import {
  DASHBOARD_COLUMNS,
  DEFAULT_VISIBLE_COLUMNS,
  type DashboardColumnId,
} from '../lib/dashboard-columns.js';

const PREF_KEY = 'dashboard.columns';
const VALID_IDS = new Set<string>(DASHBOARD_COLUMNS.map((c) => c.id));

export interface DashboardColumns {
  readonly visible: ReadonlySet<DashboardColumnId>;
  readonly setVisible: (id: DashboardColumnId, on: boolean) => void;
  readonly reset: () => void;
}

export function useDashboardColumns(): DashboardColumns {
  const prefs = usePreferences();
  const upsert = useUpsertPreference();
  const [override, setOverride] = useState<ReadonlySet<DashboardColumnId> | null>(null);

  const persisted = useMemo((): ReadonlySet<DashboardColumnId> => {
    const entry = prefs.data?.find((p) => p.key === PREF_KEY);
    if (entry?.value) {
      try {
        const arr: unknown = JSON.parse(entry.value);
        if (Array.isArray(arr)) {
          return new Set(arr.filter((x): x is DashboardColumnId => typeof x === 'string' && VALID_IDS.has(x)));
        }
      } catch {
        // Fall through to defaults on malformed preference.
      }
    }
    return new Set(DEFAULT_VISIBLE_COLUMNS);
  }, [prefs.data]);

  const visible = override ?? persisted;

  const persist = useCallback((next: ReadonlySet<DashboardColumnId>): void => {
    setOverride(next);
    upsert.mutate({ key: PREF_KEY, value: JSON.stringify([...next]) });
  }, [upsert]);

  const setVisible = useCallback((id: DashboardColumnId, on: boolean): void => {
    const next = new Set(visible);
    if (on) next.add(id);
    else next.delete(id);
    persist(next);
  }, [visible, persist]);

  const reset = useCallback((): void => {
    persist(new Set(DEFAULT_VISIBLE_COLUMNS));
  }, [persist]);

  return { visible, setVisible, reset };
}
