// ===========================================
// Channel Selection Hook
// ===========================================
// Manages checkbox selection state for bulk operations.

import { useState, useCallback, useMemo } from 'react';

interface UseChannelSelectionReturn {
  readonly selectedIds: ReadonlySet<string>;
  readonly isSelected: (id: string) => boolean;
  readonly toggle: (id: string) => void;
  readonly selectAll: (ids: readonly string[]) => void;
  readonly clearAll: () => void;
  readonly isAllSelected: (ids: readonly string[]) => boolean;
  readonly count: number;
}

export function useChannelSelection(): UseChannelSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const isSelected = useCallback((id: string): boolean => selectedIds.has(id), [selectedIds]);

  const toggle = useCallback((id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: readonly string[]): void => {
    setSelectedIds(new Set(ids));
  }, []);

  const clearAll = useCallback((): void => {
    setSelectedIds(new Set());
  }, []);

  const isAllSelected = useCallback(
    (ids: readonly string[]): boolean => ids.length > 0 && ids.every((id) => selectedIds.has(id)),
    [selectedIds],
  );

  const count = useMemo(() => selectedIds.size, [selectedIds]);

  return { selectedIds, isSelected, toggle, selectAll, clearAll, isAllSelected, count };
}
