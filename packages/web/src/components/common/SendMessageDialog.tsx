// ===========================================
// Send Message Dialog
// ===========================================
// Dialog with Monaco editor for sending raw messages to a deployed channel.
// Fire-and-forget: closes immediately on send, notifications arrive async.

import { useState, type ReactNode } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Editor from '@monaco-editor/react';
import { useUiStore } from '../../stores/ui.store.js';
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
  const themeMode = useUiStore((state) => state.themeMode);
  const { notify } = useNotification();
  const sendMessage = useSendMessage();

  const handleSend = (): void => {
    if (!content.trim()) return;
    // Fire-and-forget: close immediately, notify async
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
        <Typography variant="body2" color="text.secondary">
          Send a raw message to <strong>{channelName}</strong>
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, mt: 1 }}>
          <Editor
            height="300px"
            language="text"
            theme={themeMode === 'dark' ? 'vs-dark' : 'light'}
            value={content}
            onChange={(value) => { setContent(value ?? ''); }}
            options={{
              minimap: { enabled: false },
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              fontSize: 13,
            }}
          />
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
