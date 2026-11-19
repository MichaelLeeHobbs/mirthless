import { useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { TextEditor } from '../editors/TextEditor.js';
import { useNotification } from '../../stores/notification.store.js';
import { useSendMessage } from '../../hooks/use-deployment.js';

interface SendMessageDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly channelId: string;
  readonly channelName: string;
}

export function SendMessageDialog({ open, onClose, channelId, channelName }: SendMessageDialogProps): ReactNode {
  const [content, setContent] = useState('');
  const { notify } = useNotification();
  const sendMessage = useSendMessage();

  const handleSend = (): void => {
    if (!content.trim()) return;
    // Fire-and-forget: the dialog closes now and the outcome arrives as a notification.
    sendMessage.mutate(
      { channelId, content },
      {
        onSuccess: () => {
          notify('Message sent successfully', 'success');
        },
        onError: (error) => {
          notify(`Failed to send message: ${error.message}`, 'error');
        },
      },
    );
    setContent('');
    onClose();
  };

  const handleClose = (): void => {
    setContent('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        Send Message
        <Typography variant="body2" sx={{
          color: 'text.secondary'
        }}>
          Send a raw message to <strong>{channelName}</strong>
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ mt: 1 }}>
          <TextEditor label="Message" value={content} onChange={setContent} language="hl7" height="300px" />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSend}
          disabled={!content.trim()}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
