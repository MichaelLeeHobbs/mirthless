// Prefer a skeleton, which keeps the layout; LoadingBlock is for whole-page or route-level suspense.

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
  /** Theme spacing units. */
  readonly py?: number;
}

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
