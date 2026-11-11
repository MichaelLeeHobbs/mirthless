// ===========================================
// MessageSearchBar Tests
// ===========================================

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { darkTheme } from '../../../styles/theme.js';
import { MessageSearchBar } from '../MessageSearchBar.js';

const noop = (): void => undefined;

function renderBar(contentEncrypted: boolean): void {
  render(
    <ThemeProvider theme={darkTheme}>
      <MessageSearchBar
        receivedFrom="" receivedTo="" statuses={[]} metaDataId="" messageId="" contentSearch=""
        contentEncrypted={contentEncrypted}
        onReceivedFromChange={noop} onReceivedToChange={noop} onStatusesChange={noop}
        onMetaDataIdChange={noop} onMessageIdChange={noop} onContentSearchChange={noop}
      />
    </ThemeProvider>,
  );
}

afterEach(cleanup);

describe('MessageSearchBar', () => {
  it('offers content search on a channel that stores readable content', () => {
    renderBar(false);
    expect((screen.getByLabelText('Search content') as HTMLInputElement).disabled).toBe(false);
  });

  it('turns content search off and says why on a channel that encrypts stored content', () => {
    renderBar(true);
    expect((screen.getByLabelText('Search content') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/encrypts stored content/i)).toBeTruthy();
  });
});
