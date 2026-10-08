// ===========================================
// Queue Settings Section Tests
// ===========================================
// "Wait for Previous Destination" controls destination ordering, so it must be
// available whatever the queue mode, and toggling it must write waitForPrevious.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import { QueueSettingsSection } from '../destinations/QueueSettingsSection.js';
import { createDefaultDestination } from '../destinations/connector-defaults.js';

afterEach(() => { cleanup(); });

function renderSection(queueMode: string): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <ThemeProvider theme={darkTheme}>
      <QueueSettingsSection destination={{ ...createDefaultDestination(1), queueMode }} onChange={onChange} />
    </ThemeProvider>,
  );
  return onChange;
}

describe('QueueSettingsSection', () => {
  it('offers Wait for Previous Destination when queuing is off', () => {
    const onChange = renderSection('NEVER');
    fireEvent.click(screen.getByLabelText('Wait for Previous Destination'));
    expect(onChange).toHaveBeenCalledWith({ waitForPrevious: true });
  });

  it('does not offer queue thread count or rotate queue, which the engine ignores', () => {
    renderSection('ALWAYS');
    expect(screen.queryByLabelText('Queue Thread Count')).toBeNull();
    expect(screen.queryByLabelText('Rotate Queue')).toBeNull();
    expect(screen.getByLabelText('Wait for Previous Destination')).toBeTruthy();
  });
});
