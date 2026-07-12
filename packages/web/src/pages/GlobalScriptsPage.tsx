// ===========================================
// Global Scripts Page
// ===========================================
// 4-tab Monaco editor page for global scripts (deploy, undeploy, preprocessor, postprocessor).
// Modeled after ScriptsTab.tsx.

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import { ScriptEditor } from '../components/editors/ScriptEditor.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { useNotification } from '../stores/notification.store.js';
import { useBlocker } from 'react-router-dom';
import { useGlobalScripts, useUpdateGlobalScripts } from '../hooks/use-global-scripts.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { LoadingBlock } from '../components/common/states/LoadingState.js';

const TABS = [
  { key: 'deploy' as const, label: 'Deploy' },
  { key: 'undeploy' as const, label: 'Undeploy' },
  { key: 'preprocessor' as const, label: 'Preprocessor' },
  { key: 'postprocessor' as const, label: 'Postprocessor' },
] as const;

type ScriptKey = typeof TABS[number]['key'];

interface ScriptsState {
  deploy: string;
  undeploy: string;
  preprocessor: string;
  postprocessor: string;
}

export function GlobalScriptsPage(): ReactNode {
  const { data, isLoading, isFetching, error, refetch } = useGlobalScripts();
  const updateMutation = useUpdateGlobalScripts();
  const { notify } = useNotification();

  const [scripts, setScripts] = useState<ScriptsState>({
    deploy: '',
    undeploy: '',
    preprocessor: '',
    postprocessor: '',
  });
  const [activeTab, setActiveTab] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [blockerConfirmOpen, setBlockerConfirmOpen] = useState(false);

  // Load data into form
  useEffect(() => {
    if (data) {
      setScripts({
        deploy: data.deploy,
        undeploy: data.undeploy,
        preprocessor: data.preprocessor,
        postprocessor: data.postprocessor,
      });
      setDirty(false);
    }
  }, [data]);

  // Dirty tracking — block navigation
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setBlockerConfirmOpen(true);
    }
  }, [blocker.state]);

  const handleBlockerConfirm = (): void => {
    setBlockerConfirmOpen(false);
    blocker.proceed?.();
  };

  const handleBlockerCancel = (): void => {
    setBlockerConfirmOpen(false);
    blocker.reset?.();
  };

  const handleScriptChange = useCallback((key: ScriptKey, value: string | undefined): void => {
    setScripts((prev) => ({ ...prev, [key]: value ?? '' }));
    setDirty(true);
  }, []);

  const handleSave = async (): Promise<void> => {
    try {
      await updateMutation.mutateAsync(scripts);
      setDirty(false);
      notify('Global scripts saved', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to save', 'error');
    }
  };

  const activeKey = TABS[activeTab]!.key;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      <PageHeader
        title="Global Scripts"
        description="Server-wide deploy, undeploy, and pre/post-processor scripts run for every channel."
        isFetching={isFetching && !isLoading}
        actions={
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={!dirty || updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        }
      />

      {error ? (
        <ErrorState
          title="Couldn't load global scripts"
          error={error}
          onRetry={() => void refetch()}
          sx={{ mb: 2 }}
        />
      ) : null}

      {isLoading ? (
        <LoadingBlock label="Loading scripts" />
      ) : (
        <>
          {/* Tabs */}
          <Tabs
            value={activeTab}
            onChange={(_e, v: number) => { setActiveTab(v); }}
            sx={{ borderBottom: 1, borderColor: 'divider' }}
          >
            {TABS.map((tab) => (
              <Tab key={tab.key} label={tab.label} />
            ))}
          </Tabs>

          {/* Editor */}
          <Box sx={{ flexGrow: 1, mt: 1, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <ScriptEditor
              height="100%"
              value={scripts[activeKey]}
              onChange={(value) => { handleScriptChange(activeKey, value); }}
              showLanguageToggle
            />
          </Box>
        </>
      )}

      {/* Navigation blocker dialog */}
      <ConfirmDialog
        open={blockerConfirmOpen}
        title="Unsaved Changes"
        message="You have unsaved changes. Leave anyway?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        severity="warning"
        onConfirm={handleBlockerConfirm}
        onCancel={handleBlockerCancel}
      />
    </Box>
  );
}
