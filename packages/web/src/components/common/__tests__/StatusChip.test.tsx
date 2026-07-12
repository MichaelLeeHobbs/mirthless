// ===========================================
// StatusChip / StatusDot Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';
import { StatusChip, StatusDot, ChannelStateChip, MessageStatusChip } from '../StatusChip.js';

function renderThemed(node: ReactElement): void {
  render(<ThemeProvider theme={darkTheme}>{node}</ThemeProvider>);
}

describe('StatusChip', () => {
  afterEach(() => { cleanup(); });

  it('renders the label text so state is never colour-alone', () => {
    renderThemed(<StatusChip label="STARTED" level="healthy" />);
    expect(screen.getByText('STARTED')).toBeTruthy();
  });

  it('exposes a status role for assistive tech', () => {
    renderThemed(<StatusChip label="ERROR" level="critical" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});

describe('StatusDot', () => {
  afterEach(() => { cleanup(); });

  it('is an accessible image with a label when a title is given', () => {
    renderThemed(<StatusDot level="warning" title="Paused" />);
    expect(screen.getByRole('img', { name: 'Paused' })).toBeTruthy();
  });
});

describe('ChannelStateChip / MessageStatusChip', () => {
  afterEach(() => { cleanup(); });

  it('renders the channel state label', () => {
    renderThemed(<ChannelStateChip state="STOPPED" />);
    expect(screen.getByText('STOPPED')).toBeTruthy();
  });

  it('renders the message status label', () => {
    renderThemed(<MessageStatusChip status="SENT" />);
    expect(screen.getByText('SENT')).toBeTruthy();
  });
});
