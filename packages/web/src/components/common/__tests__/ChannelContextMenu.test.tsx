// ===========================================
// Channel Context Menu Tests
// ===========================================

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactElement } from 'react';
import { darkTheme } from '../../../styles/theme.js';

// ----- Mocks -----

const deployMutate = vi.fn();
const toggleEnabledMutate = vi.fn();
let permissions = new Set<string>(['channels:read', 'channels:write', 'channels:deploy', 'channels:delete']);

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../hooks/use-deployment.js', () => ({
  useDeploymentAction: () => ({ mutate: deployMutate }),
}));
vi.mock('../../../hooks/use-channels.js', () => ({
  useToggleChannelEnabled: () => ({ mutate: toggleEnabledMutate }),
}));
vi.mock('../../../hooks/use-permissions.js', () => ({
  usePermissions: () => ({ has: (p: string) => permissions.has(p) }),
}));

import { ChannelContextMenu } from '../ChannelContextMenu.js';

function renderMenu(props: Partial<Parameters<typeof ChannelContextMenu>[0]> = {}): void {
  const node: ReactElement = (
    <ThemeProvider theme={darkTheme}>
      <ChannelContextMenu
        menuState={{ mouseX: 10, mouseY: 10 }}
        channelId="ch-1"
        channelName="My Channel"
        state="STOPPED"
        enabled={true}
        onClose={vi.fn()}
        {...props}
      />
    </ThemeProvider>
  );
  render(node);
}

beforeEach(() => {
  deployMutate.mockClear();
  toggleEnabledMutate.mockClear();
  permissions = new Set(['channels:read', 'channels:write', 'channels:deploy', 'channels:delete']);
});
afterEach(() => { cleanup(); });

describe('ChannelContextMenu', () => {
  it('shows Disable for an enabled channel and toggles it off', () => {
    renderMenu({ enabled: true });
    const item = screen.getByText('Disable');
    fireEvent.click(item);
    expect(toggleEnabledMutate).toHaveBeenCalledWith({ id: 'ch-1', enabled: false });
  });

  it('shows Enable for a disabled channel and toggles it on', () => {
    renderMenu({ enabled: false });
    fireEvent.click(screen.getByText('Enable'));
    expect(toggleEnabledMutate).toHaveBeenCalledWith({ id: 'ch-1', enabled: true });
  });

  it('hides the Enable/Disable item when enabled is undefined', () => {
    renderMenu({ enabled: undefined });
    expect(screen.queryByText('Enable')).toBeNull();
    expect(screen.queryByText('Disable')).toBeNull();
  });

  it('hides the Enable/Disable item without channels:write', () => {
    permissions = new Set(['channels:read']);
    renderMenu({ enabled: true });
    expect(screen.queryByText('Disable')).toBeNull();
  });

  it('invokes clone/delete with id and name', () => {
    const onClone = vi.fn();
    const onDelete = vi.fn();
    renderMenu({ onClone, onDelete });
    fireEvent.click(screen.getByText('Clone'));
    expect(onClone).toHaveBeenCalledWith('ch-1', 'My Channel');
    cleanup();
    renderMenu({ onClone, onDelete });
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('ch-1', 'My Channel');
  });

  it('offers state-appropriate deploy actions (Start/Undeploy when STOPPED)', () => {
    renderMenu({ state: 'STOPPED' });
    expect(screen.getByText('Start')).toBeTruthy();
    expect(screen.getByText('Undeploy')).toBeTruthy();
    expect(screen.queryByText('Pause')).toBeNull();
  });
});
