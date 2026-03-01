// ===========================================
// Code Template Page
// ===========================================
// Two-panel page: library tree (left) + template editor (right).

import { useState, useCallback, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import AddIcon from '@mui/icons-material/Add';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import { LibraryTree } from '../components/code-templates/LibraryTree.js';
import { TemplateEditor } from '../components/code-templates/TemplateEditor.js';
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

export function CodeTemplatePage(): ReactNode {
  const { data: libraries = [], isLoading: libLoading } = useCodeTemplateLibraries();
  const { data: templates = [], isLoading: tmplLoading } = useCodeTemplates();

  const createLibrary = useCreateLibrary();
  const updateLibrary = useUpdateLibrary();
  const deleteLibrary = useDeleteLibrary();
  const createTemplate = useCreateTemplate();
  const updateTemplate = useUpdateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const [selectedTemplate, setSelectedTemplate] = useState<CodeTemplateDetail | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [editingLibrary, setEditingLibrary] = useState<CodeTemplateLibrary | null>(null);
  const [dialogName, setDialogName] = useState('');
  const [dialogDescription, setDialogDescription] = useState('');
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const handleDeselectTemplate = useCallback((): void => {
    setSelectedTemplate(null);
  }, []);

  const handleCreateLibrary = async (): Promise<void> => {
    try {
      await createLibrary.mutateAsync({ name: dialogName, description: dialogDescription });
      setDialogMode(null);
      setDialogName('');
      setDialogDescription('');
      setSnackbar('Library created');
    } catch (e) {
      setSnackbar(e instanceof Error ? e.message : 'Failed to create library');
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
      setSnackbar('Library updated');
    } catch (e) {
      setSnackbar(e instanceof Error ? e.message : 'Failed to update library');
    }
  };

  const handleDeleteLibrary = async (lib: CodeTemplateLibrary): Promise<void> => {
    if (!window.confirm(`Delete library "${lib.name}" and all its templates?`)) return;
    try {
      await deleteLibrary.mutateAsync(lib.id);
      if (selectedTemplate?.libraryId === lib.id) {
        setSelectedTemplate(null);
      }
      setSnackbar('Library deleted');
    } catch (e) {
      setSnackbar(e instanceof Error ? e.message : 'Failed to delete library');
    }
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
      setSnackbar('Template created');
    } catch (e) {
      setSnackbar(e instanceof Error ? e.message : 'Failed to create template');
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
      setSnackbar('Template saved');
    } catch (e) {
      setSnackbar(e instanceof Error ? e.message : 'Failed to save template');
    }
  };

  const handleDeleteTemplate = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this template?')) return;
    try {
      await deleteTemplate.mutateAsync(id);
      setSelectedTemplate(null);
      setSnackbar('Template deleted');
    } catch (e) {
      setSnackbar(e instanceof Error ? e.message : 'Failed to delete template');
    }
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
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Code Templates
        </Typography>
        <Stack direction="row" spacing={1}>
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
              else { setSnackbar('Create a library first'); }
            }}
            disabled={libraries.length === 0}
            size="small"
          >
            Template
          </Button>
        </Stack>
      </Stack>

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
            <Typography sx={{ p: 2 }} color="text.secondary">Loading...</Typography>
          ) : (
            <LibraryTree
              libraries={libraries}
              templates={templates}
              selectedTemplateId={selectedTemplate?.id ?? null}
              onSelectTemplate={setSelectedTemplate}
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
