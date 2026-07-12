// ===========================================
// Loading States
// ===========================================
// Skeletons over spinners: a skeleton preserves layout and reads as "content is
// arriving" rather than "the app is stuck". `TableSkeleton` fills a table body
// with shimmer rows that match the real column count; `LoadingBlock` is a
// centered fallback for whole-page / route-level suspense.

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';

interface TableSkeletonProps {
  readonly rows?: number;
  readonly columns: number;
}

/** Shimmer rows sized to the real table, for use inside a <TableBody>. */
export function TableSkeleton({ rows = 6, columns }: TableSkeletonProps): ReactNode {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r}>
          {Array.from({ length: columns }).map((__, colIdx) => (
            <TableCell key={colIdx}>
              <Skeleton variant="text" width={colIdx === 0 ? '40%' : '70%'} />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

interface LoadingBlockProps {
  readonly label?: string;
  /** Vertical padding multiple (theme spacing). */
  readonly py?: number;
}

/** A centered spinner block for suspense / whole-section loading. */
export function LoadingBlock({ label, py = 8 }: LoadingBlockProps): ReactNode {
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, py }}
    >
      <CircularProgress aria-label={label ?? 'Loading'} />
      {label ? (
        <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.875rem' }}>
          {label}
        </Box>
      ) : null}
    </Box>
  );
}
