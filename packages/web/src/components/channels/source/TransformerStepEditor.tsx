// ===========================================
// Transformer Step Editor
// ===========================================
// Shared component for editing a single transformer step.
// Used by both source and destination transformer sections.

import { type ReactNode, type ChangeEvent } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import Editor from '@monaco-editor/react';
import type { TransformerStepFormValues } from './types.js';

interface TransformerStepEditorProps {
  readonly step: TransformerStepFormValues;
  readonly index: number;
  readonly total: number;
  readonly onChange: (updates: Partial<TransformerStepFormValues>) => void;
  readonly onRemove: () => void;
  readonly onMoveUp: () => void;
  readonly onMoveDown: () => void;
}

export function TransformerStepEditor({
  step,
  index,
  total,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TransformerStepEditorProps): ReactNode {
  const title = step.name || `Step ${String(index + 1)}`;
  const typeLabel =
    step.type === 'JAVASCRIPT' ? 'JavaScript' :
    step.type === 'MAPPER' ? 'Mapper' : 'Message Builder';

  return (
    <Accordion disableGutters>
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{ '& .MuiAccordionSummary-content': { alignItems: 'center', gap: 1 } }}
      >
        <Typography sx={{ fontWeight: 600, flexGrow: 1 }}>{title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
          {typeLabel}
        </Typography>
        {!step.enabled ? (
          <Typography variant="caption" color="warning.main" sx={{ mr: 1 }}>
            Disabled
          </Typography>
        ) : null}
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            label="Name"
            value={step.name}
            onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ name: e.target.value }); }}
            size="small"
            sx={{ flexGrow: 1, minWidth: 200 }}
          />
          <TextField
            label="Type"
            value={step.type}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              onChange({ type: e.target.value as TransformerStepFormValues['type'] });
            }}
            select
            size="small"
            sx={{ minWidth: 170 }}
          >
            <MenuItem value="JAVASCRIPT">JavaScript</MenuItem>
            <MenuItem value="MAPPER">Mapper</MenuItem>
            <MenuItem value="MESSAGE_BUILDER">Message Builder</MenuItem>
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={step.enabled}
                onChange={(_e, checked) => { onChange({ enabled: checked }); }}
                size="small"
              />
            }
            label="Enabled"
          />
        </Box>

        {step.type === 'JAVASCRIPT' || step.type === 'MESSAGE_BUILDER' ? (
          <Editor
            height="200px"
            language="javascript"
            theme="vs-dark"
            value={step.script}
            onChange={(value) => { onChange({ script: value ?? '' }); }}
            options={{
              minimap: { enabled: false },
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              fontSize: 13,
              tabSize: 2,
              wordWrap: 'on',
            }}
          />
        ) : (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <TextField
              label="Source Field"
              value={step.sourceField}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ sourceField: e.target.value }); }}
              size="small"
              placeholder='e.g. msg["PID"]["PID.3"]'
              sx={{ flexGrow: 1, minWidth: 200 }}
            />
            <TextField
              label="Target Field"
              value={step.targetField}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ targetField: e.target.value }); }}
              size="small"
              placeholder='e.g. tmp["patientId"]'
              sx={{ flexGrow: 1, minWidth: 200 }}
            />
            <TextField
              label="Default Value"
              value={step.defaultValue}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ defaultValue: e.target.value }); }}
              size="small"
              sx={{ minWidth: 150 }}
            />
            <TextField
              label="Mapping"
              value={step.mapping}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onChange({ mapping: e.target.value }); }}
              select
              size="small"
              sx={{ minWidth: 120 }}
            >
              <MenuItem value="COPY">Copy</MenuItem>
              <MenuItem value="SET">Set</MenuItem>
              <MenuItem value="APPEND">Append</MenuItem>
            </TextField>
          </Box>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, gap: 0.5 }}>
          <IconButton size="small" onClick={onMoveUp} disabled={index === 0} title="Move up">
            <ArrowUpwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onMoveDown} disabled={index === total - 1} title="Move down">
            <ArrowDownwardIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onRemove} color="error" title="Remove step">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
