// ===========================================
// Destination Transformer Section
// ===========================================
// Reuses TransformerStepEditor from source. Scoped to a single destination's transformer.

import { useCallback, type ReactNode, type ChangeEvent } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AddIcon from '@mui/icons-material/Add';
import type { TransformerFormValues, TransformerStepFormValues } from '../source/types.js';
import { createDefaultTransformerStep } from '../source/types.js';
import { TransformerStepEditor } from '../source/TransformerStepEditor.js';

const DATA_TYPES = [
  { value: 'RAW', label: 'Raw' },
  { value: 'HL7V2', label: 'HL7 v2.x' },
  { value: 'HL7V3', label: 'HL7 v3' },
  { value: 'XML', label: 'XML' },
  { value: 'JSON', label: 'JSON' },
  { value: 'DICOM', label: 'DICOM' },
  { value: 'DELIMITED', label: 'Delimited' },
  { value: 'FHIR', label: 'FHIR' },
] as const;

interface DestinationTransformerSectionProps {
  readonly transformer: TransformerFormValues;
  readonly onChange: (transformer: TransformerFormValues) => void;
}

export function DestinationTransformerSection({ transformer, onChange }: DestinationTransformerSectionProps): ReactNode {
  const handleAdd = useCallback((): void => {
    onChange({ ...transformer, steps: [...transformer.steps, createDefaultTransformerStep()] });
  }, [transformer, onChange]);

  const handleStepChange = useCallback((index: number, updates: Partial<TransformerStepFormValues>): void => {
    const updated = transformer.steps.map((s, i) => (i === index ? { ...s, ...updates } : s));
    onChange({ ...transformer, steps: updated });
  }, [transformer, onChange]);

  const handleRemove = useCallback((index: number): void => {
    onChange({ ...transformer, steps: transformer.steps.filter((_, i) => i !== index) });
  }, [transformer, onChange]);

  const handleMoveUp = useCallback((index: number): void => {
    if (index <= 0) return;
    const updated = [...transformer.steps];
    const temp = updated[index - 1]!;
    updated[index - 1] = updated[index]!;
    updated[index] = temp;
    onChange({ ...transformer, steps: updated });
  }, [transformer, onChange]);

  const handleMoveDown = useCallback((index: number): void => {
    if (index >= transformer.steps.length - 1) return;
    const updated = [...transformer.steps];
    const temp = updated[index + 1]!;
    updated[index + 1] = updated[index]!;
    updated[index] = temp;
    onChange({ ...transformer, steps: updated });
  }, [transformer, onChange]);

  return (
    <Accordion disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography sx={{ fontWeight: 600, mr: 2 }}>Destination Transformer</Typography>
        <Typography variant="body2" color="text.secondary">
          {transformer.steps.length === 0
            ? 'No transformer steps'
            : `${String(transformer.steps.length)} step${transformer.steps.length === 1 ? '' : 's'}`}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField
            label="Inbound Data Type"
            value={transformer.inboundDataType}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              onChange({ ...transformer, inboundDataType: e.target.value });
            }}
            select
            size="small"
            sx={{ minWidth: 160 }}
          >
            {DATA_TYPES.map((dt) => (
              <MenuItem key={dt.value} value={dt.value}>{dt.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            label="Outbound Data Type"
            value={transformer.outboundDataType}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              onChange({ ...transformer, outboundDataType: e.target.value });
            }}
            select
            size="small"
            sx={{ minWidth: 160 }}
          >
            {DATA_TYPES.map((dt) => (
              <MenuItem key={dt.value} value={dt.value}>{dt.label}</MenuItem>
            ))}
          </TextField>
        </Box>

        {transformer.steps.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No transformer steps.
          </Typography>
        ) : (
          <Box sx={{ mb: 2 }}>
            {transformer.steps.map((step, index) => (
              <TransformerStepEditor
                key={index}
                step={step}
                index={index}
                total={transformer.steps.length}
                onChange={(updates) => { handleStepChange(index, updates); }}
                onRemove={() => { handleRemove(index); }}
                onMoveUp={() => { handleMoveUp(index); }}
                onMoveDown={() => { handleMoveDown(index); }}
              />
            ))}
          </Box>
        )}
        <Button startIcon={<AddIcon />} onClick={handleAdd} size="small">
          Add Step
        </Button>
      </AccordionDetails>
    </Accordion>
  );
}
