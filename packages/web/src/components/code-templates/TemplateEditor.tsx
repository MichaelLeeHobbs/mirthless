// ===========================================
// Template Editor
// ===========================================
// Form for editing a code template: name, type, contexts, and Monaco code editor.

import { useState, useEffect, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import Editor from '@monaco-editor/react';
import { CODE_TEMPLATE_CONTEXTS } from '@mirthless/core-models';
import type { CodeTemplateDetail } from '../../api/client.js';

const CONTEXT_LABELS: Record<string, string> = {
  GLOBAL_DEPLOY: 'Global Deploy',
  GLOBAL_UNDEPLOY: 'Global Undeploy',
  GLOBAL_PREPROCESSOR: 'Global Preprocessor',
  GLOBAL_POSTPROCESSOR: 'Global Postprocessor',
  CHANNEL_DEPLOY: 'Channel Deploy',
  CHANNEL_UNDEPLOY: 'Channel Undeploy',
  CHANNEL_PREPROCESSOR: 'Channel Preprocessor',
  CHANNEL_POSTPROCESSOR: 'Channel Postprocessor',
  CHANNEL_ATTACHMENT: 'Channel Attachment',
  CHANNEL_BATCH: 'Channel Batch',
  SOURCE_RECEIVER: 'Source Receiver',
  SOURCE_FILTER_TRANSFORMER: 'Source Filter/Transformer',
  DESTINATION_FILTER_TRANSFORMER: 'Dest Filter/Transformer',
  DESTINATION_DISPATCHER: 'Dest Dispatcher',
  DESTINATION_RESPONSE_TRANSFORMER: 'Dest Response Transformer',
};

interface TemplateEditorProps {
  readonly template: CodeTemplateDetail;
  readonly onSave: (updates: {
    name: string;
    description: string;
    type: string;
    code: string;
    contexts: readonly string[];
    revision: number;
  }) => void;
  readonly onDelete: (id: string) => void;
  readonly onClose: () => void;
  readonly saving: boolean;
}

export function TemplateEditor({ template, onSave, onDelete, onClose, saving }: TemplateEditorProps): ReactNode {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [type, setType] = useState(template.type);
  const [code, setCode] = useState(template.code);
  const [contexts, setContexts] = useState<ReadonlySet<string>>(new Set(template.contexts));

  // Reset form when template changes
  useEffect(() => {
    setName(template.name);
    setDescription(template.description ?? '');
    setType(template.type);
    setCode(template.code);
    setContexts(new Set(template.contexts));
  }, [template.id, template.revision, template.name, template.description, template.type, template.code, template.contexts]);

  const toggleContext = (ctx: string): void => {
    setContexts((prev) => {
      const next = new Set(prev);
      if (next.has(ctx)) {
        next.delete(ctx);
      } else {
        next.add(ctx);
      }
      return next;
    });
  };

  const handleSave = (): void => {
    onSave({
      name,
      description,
      type,
      code,
      contexts: [...contexts],
      revision: template.revision,
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {template.name}
        </Typography>
        <IconButton size="small" onClick={onClose} aria-label="Close editor">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={2}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => { setName(e.target.value); }}
          size="small"
          sx={{ flex: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Type</InputLabel>
          <Select
            value={type}
            label="Type"
            onChange={(e) => { setType(e.target.value); }}
          >
            <MenuItem value="FUNCTION">Function</MenuItem>
            <MenuItem value="CODE_BLOCK">Code Block</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <TextField
        label="Description"
        value={description}
        onChange={(e) => { setDescription(e.target.value); }}
        size="small"
        multiline
        minRows={2}
      />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Contexts</Typography>
        <FormGroup row>
          {CODE_TEMPLATE_CONTEXTS.map((ctx) => (
            <FormControlLabel
              key={ctx}
              control={
                <Checkbox
                  checked={contexts.has(ctx)}
                  onChange={() => { toggleContext(ctx); }}
                  size="small"
                />
              }
              label={CONTEXT_LABELS[ctx] ?? ctx}
              sx={{ mr: 2, '& .MuiFormControlLabel-label': { fontSize: '0.8rem' } }}
            />
          ))}
        </FormGroup>
      </Box>

      <Box sx={{ flexGrow: 1, minHeight: 300, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Editor
          height="100%"
          language="javascript"
          theme="vs-dark"
          value={code}
          onChange={(value) => { setCode(value ?? ''); }}
          options={{
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            fontSize: 13,
            tabSize: 2,
            wordWrap: 'on',
          }}
        />
      </Box>

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button
          variant="outlined"
          color="error"
          onClick={() => { onDelete(template.id); }}
        >
          Delete
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !name.trim()}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Stack>
    </Box>
  );
}
