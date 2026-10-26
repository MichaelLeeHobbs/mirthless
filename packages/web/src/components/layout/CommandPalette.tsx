// ===========================================
// Command Palette
// ===========================================
// Ctrl+K (Cmd+K) "Jump to" box, like VS Code's and MedFusion's: type a few
// letters of a page, a channel or an action and press Enter. Everything it
// offers is permission-gated the same way as the sidebar.

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { usePermissions } from '../../hooks/use-permissions.js';
import { useChannels } from '../../hooks/use-channels.js';
import { useUiStore } from '../../stores/ui.store.js';
import { PERMISSION } from '../../lib/permissions.js';
import { rankCommands, type Command } from '../../lib/command-search.js';
import { NAV_SECTIONS } from './nav-items.js';

/** A palette entry: a command plus what choosing it does. */
export interface PaletteCommand extends Command {
  readonly run: () => void;
}

/** The palette shows at most this many matches, so a short query stays readable. */
const MAX_RESULTS = 12;

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onShowShortcuts: () => void;
}

/** Build every command this user may run: pages, then channels, then actions. */
function usePaletteCommands(onShowShortcuts: () => void): readonly PaletteCommand[] {
  const navigate = useNavigate();
  const { has, hasAny } = usePermissions();
  const { data: channels } = useChannels(1, 100);
  const themeMode = useUiStore((state) => state.themeMode);
  const toggleThemeMode = useUiStore((state) => state.toggleThemeMode);

  return useMemo(() => {
    const go = (path: string) => (): void => { navigate(path); };
    const pages: PaletteCommand[] = NAV_SECTIONS.flatMap((section) => section.items
      .filter((item) => (item.anyOf ? hasAny(item.anyOf) : true))
      .map((item) => ({ id: `page:${item.path}`, label: item.label, section: 'Pages', keywords: section.heading, run: go(item.path) })));
    const channelCommands: PaletteCommand[] = (channels?.data ?? []).flatMap((c) => [
      { id: `channel:${c.id}`, label: c.name, section: 'Channels', keywords: 'edit open channel', run: go(`/channels/${c.id}`) },
      { id: `messages:${c.id}`, label: `${c.name} messages`, section: 'Channels', keywords: 'browse search', run: go(`/channels/${c.id}/messages`) },
    ]);
    const actions: PaletteCommand[] = [
      ...(has(PERMISSION.CHANNELS_WRITE) ? [{ id: 'new-channel', label: 'Create channel', section: 'Actions', keywords: 'new add', run: go('/channels/new') }] : []),
      ...(has(PERMISSION.ALERTS_WRITE) ? [{ id: 'new-alert', label: 'Create alert', section: 'Actions', keywords: 'new add', run: go('/alerts/new') }] : []),
      { id: 'theme', label: themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', section: 'Actions', keywords: 'theme', run: toggleThemeMode },
      { id: 'shortcuts', label: 'Keyboard shortcuts', section: 'Actions', keywords: 'help keys', run: onShowShortcuts },
    ];
    return [...pages, ...channelCommands, ...actions];
  }, [navigate, has, hasAny, channels, themeMode, toggleThemeMode, onShowShortcuts]);
}

export function CommandPalette({ open, onClose, onShowShortcuts }: CommandPaletteProps): ReactNode {
  const commands = usePaletteCommands(onShowShortcuts);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const results = rankCommands(commands, query).slice(0, MAX_RESULTS);

  const close = (): void => { setQuery(''); setActive(0); onClose(); };
  const choose = (command: PaletteCommand | undefined): void => {
    if (!command) return;
    close();
    command.run();
  };

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (results.length === 0 ? 0 : (i + step + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  };

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }} slotProps={{ paper: { sx: { mt: '12vh' } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <SearchIcon sx={{ color: 'text.secondary' }} />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Jump to a page, channel or action"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={handleKeyDown}
          inputProps={{
            role: 'combobox',
            'aria-label': 'Jump to',
            'aria-expanded': true,
            'aria-controls': 'command-palette-results',
            'aria-activedescendant': results[active] ? `command-${results[active].id}` : undefined,
          }}
        />
      </Box>
      <PaletteResults results={results} active={active} onHover={setActive} onChoose={choose} />
    </Dialog>
  );
}

interface PaletteResultsProps {
  readonly results: readonly PaletteCommand[];
  readonly active: number;
  readonly onHover: (index: number) => void;
  readonly onChoose: (command: PaletteCommand) => void;
}

function PaletteResults({ results, active, onHover, onChoose }: PaletteResultsProps): ReactNode {
  if (results.length === 0) {
    return <Typography variant="body2" color="text.secondary" sx={{ px: 2.5, py: 3 }}>Nothing matches.</Typography>;
  }
  return (
    <Box component="ul" id="command-palette-results" role="listbox" aria-label="Results" sx={{ listStyle: 'none', m: 0, p: 1, maxHeight: '50vh', overflowY: 'auto' }}>
      {results.map((command, index) => (
        <Box
          component="li"
          key={command.id}
          id={`command-${command.id}`}
          role="option"
          aria-selected={index === active}
          onMouseMove={() => { onHover(index); }}
          onClick={() => { onChoose(command); }}
          sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2,
            px: 1.5, py: 1, borderRadius: 1, cursor: 'pointer',
            bgcolor: index === active ? 'action.selected' : 'transparent',
          }}
        >
          <Typography variant="body2" noWrap>{command.label}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{command.section}</Typography>
        </Box>
      ))}
    </Box>
  );
}
