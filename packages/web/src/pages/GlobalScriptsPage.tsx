// ===========================================
// Global Scripts Page
// ===========================================
// 4-tab Monaco editor page for global scripts (deploy, undeploy, preprocessor, postprocessor).
// Modeled after ScriptsTab.tsx.

import { useBeforeUnload } from '../hooks/use-beforeunload.js';
import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import type { ScriptLanguageCode } from '@galvanigraph/core-models';
import { ScriptEditor } from '../components/editors/ScriptEditor.js';
import { NEW_CHANNEL_SCRIPT_LANGUAGES, loadedScriptLanguage } from '../lib/script-language.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { useNotification } from '../stores/notification.store.js';
import { useBlocker } from 'react-router';
import { useGlobalScripts, useUpdateGlobalScripts } from '../hooks/use-global-scripts.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { LoadingBlock } from '../components/common/states/LoadingState.js';

// Global scripts run for every channel, so msg has no single data type.
const TABS = [
  { key: 'deploy' as const, label: 'Deploy', surface: { message: false, templateContext: 'GLOBAL_DEPLOY' } },
  { key: 'undeploy' as const, label: 'Undeploy', surface: { message: false, templateContext: 'GLOBAL_UNDEPLOY' } },
  { key: 'preprocessor' as const, label: 'Preprocessor', surface: { templateContext: 'GLOBAL_PREPROCESSOR' } },
  { key: 'postprocessor' as const, label: 'Postprocessor', surface: { templateContext: 'GLOBAL_POSTPROCESSOR' } },
] as const;

type ScriptKey = typeof TABS[number]['key'];

interface ScriptsState {
  deploy: string;
  undeploy: string;
  preprocessor: string;
  postprocessor: string;
  languages: Record<ScriptKey, ScriptLanguageCode>;
}

const EMPTY_SCRIPTS: ScriptsState = {
  deploy: '',
  undeploy: '',
  preprocessor: '',
  postprocessor: '',
  languages: { ...NEW_CHANNEL_SCRIPT_LANGUAGES },
};

export function GlobalScriptsPage(): ReactNode {
  const { data, isLoading, isFetching, error, refetch } = useGlobalScripts();
  const updateMutation = useUpdateGlobalScripts();
  const { notify } = useNotification();

  const [scripts, setScripts] = useState<ScriptsState>(EMPTY_SCRIPTS);
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
        languages: {
          deploy: loadedScriptLanguage(data.deploy, data.languages?.deploy),
          undeploy: loadedScriptLanguage(data.undeploy, data.languages?.undeploy),
          preprocessor: loadedScriptLanguage(data.preprocessor, data.languages?.preprocessor),
          postprocessor: loadedScriptLanguage(data.postprocessor, data.languages?.postprocessor),
        },
      });
      setDirty(false);
    }
  }, [data]);

  // Dirty tracking — block navigation
  const blocker = useBlocker(dirty);
  useBeforeUnload(dirty);

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

  const handleLanguageChange = useCallback((key: ScriptKey, language: ScriptLanguageCode): void => {
    setScripts((prev) => ({ ...prev, languages: { ...prev.languages, [key]: language } }));
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
          <Box sx={{ flexGrow: 1, minHeight: 0, mt: 2 }}>
            {/* One editor per tab, so undo stays in the tab it was typed in (#228). */}
            <ScriptEditor
              key={activeKey}
              height="100%"
              label={`Global ${TABS[activeTab]!.label.toLowerCase()} script`}
              surface={TABS[activeTab]!.surface}
              language={scripts.languages[activeKey]}
              onLanguageChange={(language) => { handleLanguageChange(activeKey, language); }}
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
