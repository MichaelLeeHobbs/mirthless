// ===========================================
// New Channel Dialog
// ===========================================
// Modal form for creating a new channel.

import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm, Controller } from 'react-hook-form';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import Stack from '@mui/material/Stack';
import CircularProgress from '@mui/material/CircularProgress';
import { useCreateChannel } from '../../hooks/use-channels.js';

const DATA_TYPES = ['RAW', 'HL7V2', 'HL7V3', 'XML', 'JSON', 'DICOM', 'DELIMITED', 'FHIR'] as const;

const SOURCE_CONNECTOR_TYPES = [
  'TCP_MLLP',
  'HTTP',
  'FILE',
  'DATABASE',
  'JAVASCRIPT',
  'CHANNEL',
  'DICOM',
  'FHIR',
] as const;

interface NewChannelFormData {
  readonly name: string;
  readonly description: string;
  readonly inboundDataType: string;
  readonly outboundDataType: string;
  readonly sourceConnectorType: string;
}

interface NewChannelDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function NewChannelDialog({ open, onClose }: NewChannelDialogProps): ReactNode {
  const navigate = useNavigate();
  const createChannel = useCreateChannel();

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewChannelFormData>({
    defaultValues: {
      name: '',
      description: '',
      inboundDataType: 'HL7V2',
      outboundDataType: 'HL7V2',
      sourceConnectorType: 'TCP_MLLP',
    },
  });

  const handleClose = (): void => {
    if (createChannel.isPending) return;
    reset();
    createChannel.reset();
    onClose();
  };

  const onSubmit = async (data: NewChannelFormData): Promise<void> => {
    const created = await createChannel.mutateAsync({
      name: data.name,
      description: data.description,
      enabled: false,
      inboundDataType: data.inboundDataType as typeof DATA_TYPES[number],
      outboundDataType: data.outboundDataType as typeof DATA_TYPES[number],
      sourceConnectorType: data.sourceConnectorType as typeof SOURCE_CONNECTOR_TYPES[number],
      sourceConnectorProperties: {},
      responseMode: 'AUTO_AFTER_DESTINATIONS',
    });
    reset();
    onClose();
    navigate(`/channels/${created.id}`);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogTitle>New Channel</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {createChannel.isError ? (
              <Alert severity="error">{createChannel.error.message}</Alert>
            ) : null}

            <Controller
              name="name"
              control={control}
              rules={{ required: 'Name is required', maxLength: { value: 255, message: 'Max 255 characters' } }}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Channel Name"
                  error={Boolean(errors.name)}
                  helperText={errors.name?.message}
                  autoFocus
                  fullWidth
                />
              )}
            />

            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Description"
                  multiline
                  rows={2}
                  fullWidth
                />
              )}
            />

            <Controller
              name="inboundDataType"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Inbound Data Type" select fullWidth>
                  {DATA_TYPES.map((type) => (
                    <MenuItem key={type} value={type}>{type}</MenuItem>
                  ))}
                </TextField>
              )}
            />

            <Controller
              name="outboundDataType"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Outbound Data Type" select fullWidth>
                  {DATA_TYPES.map((type) => (
                    <MenuItem key={type} value={type}>{type}</MenuItem>
                  ))}
                </TextField>
              )}
            />

            <Controller
              name="sourceConnectorType"
              control={control}
              render={({ field }) => (
                <TextField {...field} label="Source Connector" select fullWidth>
                  {SOURCE_CONNECTOR_TYPES.map((type) => (
                    <MenuItem key={type} value={type}>{type}</MenuItem>
                  ))}
                </TextField>
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose} disabled={createChannel.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createChannel.isPending}
            startIcon={createChannel.isPending ? <CircularProgress size={16} /> : null}
          >
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
