// ===========================================
// Code Template Page
// ===========================================
// Two-panel page: library tree (left) + template editor (right).

import { useState, useCallback, type ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import AddIcon from '@mui/icons-material/Add';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import { LibraryTree } from '../components/code-templates/LibraryTree.js';
import { TemplateEditor } from '../components/code-templates/TemplateEditor.js';
import { ConfirmDialog } from '../components/common/ConfirmDialog.js';
import { useNotification } from '../stores/notification.store.js';
import { PageHeader } from '../components/common/PageHeader.js';
import { ErrorState } from '../components/common/states/ErrorState.js';
import { LoadingBlock } from '../components/common/states/LoadingState.js';
import {
  useCodeTemplateLibraries,
  useCodeTemplates,
  useCreateLibrary,
  useUpdateLibrary,
  useDeleteLibrary,
  useCreateTemplate,
  useUpdateTemplate,
  useDeleteTemplate,
} from '../hooks/use-code-templates.js';
import type { CodeTemplateLibrary, CodeTemplateDetail } from '../api/client.js';

type DialogMode = 'create-library' | 'edit-library' | 'create-template' | null;

interface ConfirmState {
  readonly open: boolean;
  readonly title: string;
  readonly message: string;
  readonly onConfirm: () => void;
}

const CLOSED_CONFIRM: ConfirmState = { open: false, title: '', message: '', onConfirm: () => {} };

export function CodeTemplatePage(): ReactNode {
  const {
    data: libraries = [],
    isLoading: libLoading,
    isFetching: libFetching,
    error: libError,
    refetch: refetchLibraries,
  } = useCodeTemplateLibraries();
  const {
    data: templates = [],
    isLoading: tmplLoading,
    isFetching: tmplFetching,
    error: tmplError,
    refetch: refetchTemplates,
  } = useCodeTemplates();
  const loadError = libError ?? tmplError;

  const createLibrary = useCreateLibrary();
  const updateLibrary = useUpdateLibrary();
  const deleteLibrary = useDeleteLibrary();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const { notify } = useNotification();

  const [selectedTemplate, setSelectedTemplate] = useState<CodeTemplateDetail | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingLibrary, setEditingLibrary] = useState<CodeTemplateLibrary | null>(null);
  const [dialogName, setDialogName] = useState('');
  const [dialogDescription, setDialogDescription] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState>(CLOSED_CONFIRM);
  const [editorDirty, setEditorDirty] = useState(false);
  // undefined = no pending in-page switch; a value = switch target once confirmed.
  const [pendingSwitch, setPendingSwitch] = useState<CodeTemplateDetail | null | undefined>(undefined);

  const handleDirtyChange = useCallback((dirty: boolean): void => {
    setEditorDirty(dirty);
  }, []);

  // Guard in-page template switch / close when there are unsaved edits.
  const requestSelectTemplate = useCallback((next: CodeTemplateDetail | null): void => {
    setSelectedTemplate((current) => {
      if (current && current.id !== next?.id && editorDirty) {
        setPendingSwitch(next);
        return current;
      }
      return next;
    });
  }, [editorDirty]);

  const handleDeselectTemplate = useCallback((): void => {
    requestSelectTemplate(null);
  }, [requestSelectTemplate]);

  // Route-level navigation guard (consistent with the channel editor).
  const blocker = useBlocker(editorDirty);

  const unsavedOpen = pendingSwitch !== undefined || blocker.state === 'blocked';

  const handleUnsavedConfirm = useCallback((): void => {
    setEditorDirty(false);
    if (blocker.state === 'blocked') {
      blocker.proceed?.();
    }
    if (pendingSwitch !== undefined) {
      setSelectedTemplate(pendingSwitch);
      setPendingSwitch(undefined);
    }
  }, [blocker, pendingSwitch]);

  const handleUnsavedCancel = useCallback((): void => {
    if (blocker.state === 'blocked') {
      blocker.reset?.();
    }
    setPendingSwitch(undefined);
  }, [blocker]);

  const handleCreateLibrary = async (): Promise<void> => {
    try {
      await createLibrary.mutateAsync({ name: dialogName, description: dialogDescription });
      setDialogMode(null);
      setDialogName('');
      setDialogDescription('');
      notify('Library created', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to create library', 'error');
    }
  };

  const handleEditLibrary = async (): Promise<void> => {
    if (!editingLibrary) return;
    try {
      await updateLibrary.mutateAsync({
        id: editingLibrary.id,
        input: { name: dialogName, description: dialogDescription, revision: editingLibrary.revision },
      });
      setDialogMode(null);
      setEditingLibrary(null);
      notify('Library updated', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to update library', 'error');
    }
  };

  const handleDeleteLibrary = (lib: CodeTemplateLibrary): void => {
    setConfirm({
      open: true,
      title: 'Delete Library',
      message: `Delete library "${lib.name}" and all its templates?`,
      onConfirm: () => {
        setConfirm(CLOSED_CONFIRM);
        void (async () => {
          try {
            await deleteLibrary.mutateAsync(lib.id);
            if (selectedTemplate?.libraryId === lib.id) {
              setSelectedTemplate(null);
            }
            notify('Library deleted', 'success');
          } catch (e) {
            notify(e instanceof Error ? e.message : 'Failed to delete library', 'error');
          }
        })();
      },
    });
  };

  const handleCreateTemplate = async (libraryId: string): Promise<void> => {
    try {
      const result = await createTemplate.mutateAsync({
        libraryId,
        name: 'New Template',
        description: '',
        type: 'FUNCTION',
        code: '// Enter your code here\n',
        contexts: [],
      });
      setSelectedTemplate(result);
      notify('Template created', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to create template', 'error');
    }
  };

  const handleSaveTemplate = async (updates: {
    name: string;
    description: string;
    type: string;
    code: string;
    contexts: readonly string[];
    revision: number;
  }): Promise<void> => {
    if (!selectedTemplate) return;
    try {
      const result = await updateTemplate.mutateAsync({
        id: selectedTemplate.id,
        input: {
          name: updates.name,
          description: updates.description,
          type: updates.type as 'FUNCTION' | 'CODE_BLOCK',
          code: updates.code,
          contexts: updates.contexts as Array<typeof import('@mirthless/core-models').CODE_TEMPLATE_CONTEXTS[number]>,
          revision: updates.revision,
        },
      });
      setSelectedTemplate(result);
      notify('Template saved', 'success');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Failed to save template', 'error');
    }
  };

  const handleDeleteTemplate = (id: string): void => {
    setConfirm({
      open: true,
      title: 'Delete Template',
      message: 'Delete this template? This action cannot be undone.',
      onConfirm: () => {
        setConfirm(CLOSED_CONFIRM);
        void (async () => {
          try {
            await deleteTemplate.mutateAsync(id);
            setSelectedTemplate(null);
            notify('Template deleted', 'success');
          } catch (e) {
            notify(e instanceof Error ? e.message : 'Failed to delete template', 'error');
          }
        })();
      },
    });
  };

  const openEditLibraryDialog = (lib: CodeTemplateLibrary): void => {
    setEditingLibrary(lib);
    setDialogName(lib.name);
    setDialogDescription(lib.description ?? '');
    setDialogMode('edit-library');
  };

  const openCreateLibraryDialog = (): void => {
    setDialogName('');
    setDialogDescription('');
    setDialogMode('create-library');
  };

  const isLoading = libLoading || tmplLoading;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)' }}>
      <PageHeader
        title="Code Templates"
        description="Reusable JavaScript functions and code blocks shared across channels, organized into libraries."
        isFetching={(libFetching || tmplFetching) && !isLoading}
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={<CreateNewFolderIcon />}
              onClick={openCreateLibraryDialog}
              size="small"
            >
              Library
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                const targetId = selectedTemplate?.libraryId ?? libraries[0]?.id;
                if (targetId) { void handleCreateTemplate(targetId); }
                else { notify('Create a library first', 'warning'); }
              }}
              disabled={libraries.length === 0}
              size="small"
            >
              Template
            </Button>
          </>
        }
      />

      {loadError ? (
        <ErrorState
          title="Couldn't load code templates"
          error={loadError}
          onRetry={() => { void refetchLibraries(); void refetchTemplates(); }}
          sx={{ mb: 2 }}
        />
      ) : null}

      {/* Two-panel layout */}
      <Box sx={{ display: 'flex', flexGrow: 1, gap: 2, minHeight: 0 }}>
        {/* Left panel: Library tree */}
        <Paper
          variant="outlined"
          sx={{
            width: 280,
            minWidth: 280,
            overflow: 'auto',
          }}
        >
          {isLoading ? (
            <LoadingBlock label="Loading templates" />
          ) : (
            <LibraryTree
              libraries={libraries}
              templates={templates}
              selectedTemplateId={selectedTemplate?.id ?? null}
              onSelectTemplate={requestSelectTemplate}
              onCreateTemplate={(id) => { void handleCreateTemplate(id); }}
              onEditLibrary={openEditLibraryDialog}
              onDeleteLibrary={handleDeleteLibrary}
            />
          )}
        </Paper>

        {/* Right panel: Template editor */}
        <Paper
          variant="outlined"
          sx={{
            flexGrow: 1,
            p: 2,
            overflow: 'auto',
            minWidth: 0,
          }}
        >
          {selectedTemplate ? (
            <TemplateEditor
              template={selectedTemplate}
              onSave={handleSaveTemplate}
              onDelete={handleDeleteTemplate}
              onClose={handleDeselectTemplate}
              saving={updateTemplate.isPending}
              onDirtyChange={handleDirtyChange}
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Typography color="text.secondary">
                Select a template from the library tree to edit it.
              </Typography>
            </Box>
          )}
        </Paper>
      </Box>

      {/* Library Dialog */}
      <Dialog
        open={dialogMode === 'create-library' || dialogMode === 'edit-library'}
        onClose={() => { setDialogMode(null); }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {dialogMode === 'create-library' ? 'Create Library' : 'Edit Library'}
        </DialogTitle>
        <DialogContent>
          <TextField
            label="Name"
            value={dialogName}
            onChange={(e) => { setDialogName(e.target.value); }}
            fullWidth
            sx={{ mt: 1, mb: 2 }}
            autoFocus
          />
          <TextField
            label="Description"
            value={dialogDescription}
            onChange={(e) => { setDialogDescription(e.target.value); }}
            fullWidth
            multiline
            minRows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogMode(null); }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={dialogMode === 'create-library' ? handleCreateLibrary : handleEditLibrary}
            disabled={!dialogName.trim()}
          >
            {dialogMode === 'create-library' ? 'Create' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel="Delete"
        severity="error"
        onConfirm={confirm.onConfirm}
        onCancel={() => { setConfirm(CLOSED_CONFIRM); }}
      />

      {/* Unsaved-changes guard (template switch / close / route navigation) */}
      <ConfirmDialog
        open={unsavedOpen}
        title="Unsaved Changes"
        message="You have unsaved template changes. Discard them?"
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        severity="warning"
        onConfirm={handleUnsavedConfirm}
        onCancel={handleUnsavedCancel}
      />
    </Box>
  );
}
