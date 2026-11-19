import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

interface PageHeaderProps {
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly isFetching?: boolean;
  readonly meta?: ReactNode;
}

export function PageHeader({ title, description, actions, isFetching, meta }: PageHeaderProps): ReactNode {
  return (
    <Box sx={{ mb: 3 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h4" component="h1">
              {title}
            </Typography>
            {isFetching ? <CircularProgress size={16} thickness={5} aria-label="Refreshing" /> : null}
          </Box>
          {description ? (
            <Typography
              variant="body2"
              sx={{
                color: 'text.secondary',
                mt: 0.5,
                maxWidth: 640
              }}>
              {description}
            </Typography>
          ) : null}
          {meta ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 1 }}>{meta}</Box>
          ) : null}
        </Box>
        {actions ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>{actions}</Box>
        ) : null}
      </Box>
    </Box>
  );
}
