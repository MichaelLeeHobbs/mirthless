// ===========================================
// Content Viewer
// ===========================================
// Monospace display with basic syntax detection and copy-to-clipboard.

import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';

interface ContentViewerProps {
  readonly content: string;
  readonly label?: string;
}

function detectFormat(content: string): string {
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<')) return 'xml';
  if (trimmed.startsWith('MSH|')) return 'hl7';
  return 'text';
}

function formatContent(content: string): string {
  const format = detectFormat(content);
  if (format === 'json') {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  if (format === 'hl7') {
    // HL7: split segments by \r for readability
    return content.replace(/\r/g, '\n');
  }
  return content;
}

export function ContentViewer({ content, label }: ContentViewerProps): ReactNode {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatted = formatContent(content);
  const lines = formatted.split('\n');

  return (
    <Box sx={{ position: 'relative' }}>
      {label && (
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          {label}
        </Typography>
      )}
      <Box sx={{ position: 'absolute', top: label ? 24 : 4, right: 4, zIndex: 1 }}>
        <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
          <IconButton size="small" onClick={handleCopy}>
            {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Box>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          bgcolor: 'action.hover',
          borderRadius: 1,
          overflow: 'auto',
          maxHeight: 400,
          fontSize: '0.8125rem',
          lineHeight: 1.6,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {lines.map((line, i) => (
          <Box key={i} component="span" sx={{ display: 'block' }}>
            <Box
              component="span"
              sx={{ display: 'inline-block', width: 40, color: 'text.disabled', userSelect: 'none', textAlign: 'right', mr: 1.5 }}
            >
              {String(i + 1)}
            </Box>
            {line}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
