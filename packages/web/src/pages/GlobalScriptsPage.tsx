// ===========================================
// Global Scripts Page
// ===========================================
// 4-tab Monaco editor page for global scripts (deploy, undeploy, preprocessor, postprocessor).
// Modeled after ScriptsTab.tsx.

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import CircularProgress from '@mui/material/CircularProgress';
import { ScriptEditor } from '../components/editors/ScriptEditor.js';
import { useBlocker } from 'react-router-dom';
import { useGlobalScripts, useUpdateGlobalScripts } from '../hooks/use-global-scripts.js';

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
  const { data, isLoading } = useGlobalScripts();
  const updateMutation = useUpdateGlobalScripts();

  const [scripts, setScripts] = useState<ScriptsState>({
    deploy: '',
    undeploy: '',
    preprocessor: '',
    postprocessor: '',
  });
  const [activeTab, setActiveTab] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

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
      const leave = window.confirm('You have unsaved changes. Leave anyway?');
      if (leave) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  }, [blocker]);

  const handleScriptChange = useCallback((key: ScriptKey, value: string | undefined): void => {
    setScripts((prev) => ({ ...prev, [key]: value ?? '' }));
    setDirty(true);
  }, []);

  const handleSave = async (): Promise<void> => {
    try {
      await updateMutation.mutateAsync(scripts);
      setDirty(false);
      setSnackbar('Global scripts saved');
    } catch (e) {
      setSnackbar(e instanceof Error ? e.message : 'Failed to save');
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const activeKey = TABS[activeTab]!.key;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Global Scripts
        </Typography>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!dirty || updateMutation.isPending}
        >
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </Button>
      </Box>

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
        />
      </Box>

      {/* Snackbar */}
      <Snackbar
        open={snackbar !== null}
        autoHideDuration={4000}
        onClose={() => { setSnackbar(null); }}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => { setSnackbar(null); }}
          severity="info"
          variant="filled"
        >
          {snackbar}
        </Alert>
      </Snackbar>
    </Box>
  );
}
