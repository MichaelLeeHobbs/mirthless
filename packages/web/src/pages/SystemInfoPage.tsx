// ===========================================
// System Info Page
// ===========================================
// One page for running the server, split into tabs whose state lives in the
// path (/system, /system/logs, /system/pruner, /system/backup) so each is
// bookmarkable, back-button correct and one click away. Only the active tab is
// mounted, so leaving Overview stops its poll and leaving Logs closes the stream.

import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useSystemInfo, type SystemInfo } from '../hooks/use-system-info.js';
import { useNotification } from '../stores/notification.store.js';
import { BackupRestoreSection } from '../components/system/BackupRestoreSection.js';
import { PrunerSection } from '../components/system/PrunerSection.js';
import { LogViewer } from '../components/system/LogViewer.js';
import { SystemOverview } from '../components/system/SystemOverview.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { LoadingBlock } from '../components/common/states/LoadingState.js';
import { diagnosticsText } from '../lib/system-health.js';

interface SystemTab {
  /** Path segment after /system; empty for the default tab. */
  readonly slug: string;
  readonly label: string;
  readonly description: string;
}

const SYSTEM_TABS: readonly SystemTab[] = [
  { slug: '', label: 'Overview', description: 'Server, database, engine and memory health at a glance.' },
  { slug: 'logs', label: 'Logs', description: 'The live server log, filterable by level and text.' },
  { slug: 'pruner', label: 'Data pruner', description: 'Schedule or run the pruner that removes old message content.' },
  { slug: 'backup', label: 'Backup & restore', description: 'Download a configuration backup or restore one.' },
];

const pathFor = (slug: string): string => (slug ? `/system/${slug}` : '/system');

function CopyDiagnosticsButton({ info }: { readonly info: SystemInfo | undefined }): ReactNode {
  const { notify } = useNotification();
  const copy = (): void => {
    if (!info) return;
    navigator.clipboard.writeText(diagnosticsText(info, new Date())).then(
      () => notify('Diagnostics copied to the clipboard', 'success'),
      () => notify('Could not copy to the clipboard', 'error'),
    );
  };
  return (
    <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={copy} disabled={!info}>
      Copy diagnostics
    </Button>
  );
}

function OverviewTab({ query }: { readonly query: ReturnType<typeof useSystemInfo> }): ReactNode {
  const { data, isLoading, error, refetch } = query;
  return (
    <>
      {error ? (
        <ErrorState title="Couldn't load system info" error={error} onRetry={() => void refetch()} sx={{ mb: 2 }} />
      ) : null}
      {isLoading ? <LoadingBlock label="Loading system information" /> : null}
      {data ? <SystemOverview info={data} /> : null}
    </>
  );
}

export function SystemInfoPage(): ReactNode {
  const { tab = '' } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const active = SYSTEM_TABS.find((t) => t.slug === tab);
  const onOverview = active?.slug === '';
  const query = useSystemInfo(onOverview);

  // An unknown tab (a typo, an old bookmark) lands on Overview rather than a blank page.
  if (!active) return <Navigate to="/system" replace />;

  return (
    <Box>
      <PageHeader
        title="System Information"
        description={active.description}
        isFetching={onOverview && query.isFetching && !query.isLoading}
        actions={onOverview ? <CopyDiagnosticsButton info={query.data} /> : undefined}
      />

      <Tabs
        value={active.slug}
        onChange={(_e, slug: string) => { navigate(pathFor(slug)); }}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {SYSTEM_TABS.map((t) => <Tab key={t.slug} value={t.slug} label={t.label} />)}
      </Tabs>

      <Box role="tabpanel" aria-label={active.label}>
        {onOverview ? <OverviewTab query={query} /> : null}
        {active.slug === 'logs' ? <LogViewer /> : null}
        {active.slug === 'pruner' ? <PrunerSection /> : null}
        {active.slug === 'backup' ? <BackupRestoreSection /> : null}
      </Box>
    </Box>
  );
}
