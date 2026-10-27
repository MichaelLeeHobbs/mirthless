// ===========================================
// Header Breadcrumbs
// ===========================================
// The trail in the app bar. It reads the URL, so every page gets one without
// rendering it, and it looks up a channel, alert or collection name from the query cache
// the page already filled.

import type { ReactNode } from 'react';
import { useLocation, Link as RouterLink } from 'react-router';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useChannel } from '../../hooks/use-channels.js';
import { useAlert } from '../../hooks/use-alerts.js';
import { useCollection } from '../../hooks/use-collections.js';
import { breadcrumbsFor, crumbEntity } from '../../lib/breadcrumbs.js';
import { NAV_SECTIONS } from './nav-items.js';

const PAGES = NAV_SECTIONS.flatMap((section) => section.items);

/** Long channel names get an ellipsis instead of pushing the header apart. */
const CRUMB_SX = { display: 'block', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

interface HeaderBreadcrumbsProps {
  /** Phones show only the current page, behind a tap-to-expand ellipsis. */
  readonly compact: boolean;
}

export function HeaderBreadcrumbs({ compact }: HeaderBreadcrumbsProps): ReactNode {
  const { pathname } = useLocation();
  const entity = crumbEntity(pathname);
  const channel = useChannel(entity?.kind === 'channel' ? entity.id : null);
  const alert = useAlert(entity?.kind === 'alert' ? entity.id : null);
  const collection = useCollection(entity?.kind === 'collection' ? entity.id : '');
  const names = { channel: channel.data?.name, alert: alert.data?.name, collection: collection.data?.name };
  const name = entity ? names[entity.kind] : undefined;
  const crumbs = breadcrumbsFor(pathname, PAGES, name);

  return (
    <Breadcrumbs
      aria-label="breadcrumb"
      maxItems={compact ? 1 : 8}
      itemsBeforeCollapse={0}
      itemsAfterCollapse={1}
      sx={{ minWidth: 0, '& .MuiBreadcrumbs-ol': { flexWrap: 'nowrap' }, '& .MuiBreadcrumbs-li': { minWidth: 0 } }}
    >
      {crumbs.map((crumb) =>
        crumb.href ? (
          <Link
            key={crumb.href}
            component={RouterLink}
            to={crumb.href}
            underline="hover"
            variant="body2"
            title={crumb.label}
            sx={{ ...CRUMB_SX, color: 'text.secondary' }}
          >
            {crumb.label}
          </Link>
        ) : (
          <Typography
            key="current"
            variant="body2"
            aria-current="page"
            title={crumb.label}
            sx={{ ...CRUMB_SX, color: 'text.primary', fontWeight: 600 }}
          >
            {crumb.label}
          </Typography>
        ),
      )}
    </Breadcrumbs>
  );
}
