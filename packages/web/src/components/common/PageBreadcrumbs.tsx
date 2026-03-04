// ===========================================
// Page Breadcrumbs
// ===========================================
// Generic breadcrumb component for nested pages.

import type { ReactNode } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

interface BreadcrumbItem {
  readonly label: string;
  readonly href?: string;
}

interface PageBreadcrumbsProps {
  readonly items: readonly BreadcrumbItem[];
}

export function PageBreadcrumbs({ items }: PageBreadcrumbsProps): ReactNode {
  return (
    <Breadcrumbs sx={{ mb: 1 }}>
      {items.map((item, idx) =>
        idx < items.length - 1 && item.href ? (
          <Link
            key={item.label}
            component={RouterLink}
            to={item.href}
            underline="hover"
            color="inherit"
            variant="body2"
          >
            {item.label}
          </Link>
        ) : (
          <Typography key={item.label} variant="body2" color="text.primary">
            {item.label}
          </Typography>
        ),
      )}
    </Breadcrumbs>
  );
}
