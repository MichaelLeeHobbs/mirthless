import { useState, useCallback, type ReactNode, type MouseEvent } from 'react';
import { Outlet, useNavigate, useLocation, Link as RouterLink } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import MessageIcon from '@mui/icons-material/Message';
import CodeIcon from '@mui/icons-material/Code';
import NotificationsIcon from '@mui/icons-material/Notifications';
import EventIcon from '@mui/icons-material/Event';
import PeopleIcon from '@mui/icons-material/People';
import JavascriptIcon from '@mui/icons-material/Javascript';
import SettingsIcon from '@mui/icons-material/Settings';
import FolderIcon from '@mui/icons-material/Folder';
import FolderSpecialIcon from '@mui/icons-material/FolderSpecial';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import StorageIcon from '@mui/icons-material/Storage';
import TuneIcon from '@mui/icons-material/Tune';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import BuildIcon from '@mui/icons-material/Build';
import ExtensionIcon from '@mui/icons-material/Extension';
import SecurityIcon from '@mui/icons-material/Security';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LogoutIcon from '@mui/icons-material/Logout';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { useAuthStore } from '../../stores/auth.store.js';
import { useUiStore } from '../../stores/ui.store.js';
import { useSocketConnection } from '../../hooks/use-socket.js';
import { useKeyboardShortcuts } from '../../hooks/use-keyboard-shortcuts.js';
import { KeyboardShortcutHelp } from '../common/KeyboardShortcutHelp.js';

const DRAWER_WIDTH = 240;
const COLLAPSED_DRAWER_WIDTH = 64;

interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly icon: ReactNode;
}

interface NavSection {
  readonly heading: string;
  readonly items: readonly NavItem[];
}

const NAV_SECTIONS: readonly NavSection[] = [
  {
    heading: 'Overview',
    items: [
      { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
      { label: 'Channels', path: '/channels', icon: <SyncAltIcon /> },
      { label: 'Messages', path: '/messages', icon: <MessageIcon /> },
    ],
  },
  {
    heading: 'Channels',
    items: [
      { label: 'Channel Groups', path: '/channel-groups', icon: <FolderSpecialIcon /> },
      { label: 'Tags', path: '/tags', icon: <LocalOfferIcon /> },
      { label: 'Code Templates', path: '/code-templates', icon: <CodeIcon /> },
      { label: 'Global Scripts', path: '/global-scripts', icon: <JavascriptIcon /> },
      { label: 'Resources', path: '/resources', icon: <FolderIcon /> },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      { label: 'Alerts', path: '/alerts', icon: <NotificationsIcon /> },
      { label: 'Settings', path: '/settings', icon: <SettingsIcon /> },
      { label: 'Global Map', path: '/global-map', icon: <StorageIcon /> },
      { label: 'Config Map', path: '/config-map', icon: <TuneIcon /> },
      { label: 'Certificates', path: '/certificates', icon: <SecurityIcon /> },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Users', path: '/users', icon: <PeopleIcon /> },
      { label: 'Events', path: '/events', icon: <EventIcon /> },
    ],
  },
  {
    heading: 'System',
    items: [
      { label: 'System Info', path: '/system', icon: <InfoOutlinedIcon /> },
      { label: 'Tools', path: '/tools/message-generator', icon: <BuildIcon /> },
      { label: 'Extensions', path: '/extensions', icon: <ExtensionIcon /> },
    ],
  },
];

export function AppLayout(): ReactNode {
  useSocketConnection();

  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const themeMode = useUiStore((state) => state.themeMode);
  const toggleThemeMode = useUiStore((state) => state.toggleThemeMode);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const userMenuOpen = Boolean(anchorEl);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const handleHelpOpen = useCallback(() => { setShortcutHelpOpen(true); }, []);
  useKeyboardShortcuts({ onHelpOpen: handleHelpOpen });

  const handleUserMenuOpen = (event: MouseEvent<HTMLElement>): void => {
    setAnchorEl(event.currentTarget);
  };

  const handleUserMenuClose = (): void => {
    setAnchorEl(null);
  };

  const handleLogout = (): void => {
    handleUserMenuClose();
    clearAuth();
    navigate('/login');
  };

  const handleNavClick = (): void => {
    // Close drawer on mobile after nav click
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const drawerWidth = sidebarOpen ? DRAWER_WIDTH : COLLAPSED_DRAWER_WIDTH;
  const drawerVariant = isMobile ? 'temporary' as const : 'permanent' as const;

  const drawerContent = (
    <>
      <Toolbar />
      <List sx={{ pt: 1 }}>
        {NAV_SECTIONS.map((section) => (
          <Box key={section.heading}>
            {sidebarOpen ? (
              <ListSubheader
                sx={{
                  lineHeight: '32px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  backgroundColor: 'transparent',
                  color: 'text.secondary',
                }}
              >
                {section.heading}
              </ListSubheader>
            ) : (
              <Divider sx={{ my: 0.5 }} />
            )}
            {section.items.map((item) => {
              const isActive = item.path === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.path);
              const button = (
                <ListItemButton
                  key={item.path}
                  component={RouterLink}
                  to={item.path}
                  selected={isActive}
                  onClick={handleNavClick}
                  sx={{
                    minHeight: 40,
                    justifyContent: sidebarOpen ? 'initial' : 'center',
                    px: 2.5,
                    '&.Mui-selected': {
                      backgroundColor: 'action.selected',
                      borderRight: 3,
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 0,
                      mr: sidebarOpen ? 2 : 'auto',
                      justifyContent: 'center',
                      color: isActive ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {sidebarOpen ? <ListItemText primary={item.label} /> : null}
                </ListItemButton>
              );
              return sidebarOpen ? button : (
                <Tooltip key={item.path} title={item.label} placement="right">
                  {button}
                </Tooltip>
              );
            })}
          </Box>
        ))}
      </List>
    </>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* App Bar */}
      <AppBar
        position="fixed"
        sx={{
          zIndex: (t) => t.zIndex.drawer + 1,
          backgroundColor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
        elevation={0}
      >
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            aria-label="toggle sidebar"
            onClick={toggleSidebar}
            sx={{ mr: 2 }}
          >
            <MenuIcon />
          </IconButton>
          <Typography
            variant="h6"
            component="div"
            sx={{ flexGrow: 1, fontWeight: 700, color: 'primary.main' }}
          >
            Mirthless
          </Typography>
          <Tooltip title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <IconButton color="inherit" onClick={toggleThemeMode} aria-label="toggle theme" sx={{ mr: 1 }}>
              {themeMode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
            </IconButton>
          </Tooltip>
          <IconButton color="inherit" onClick={handleUserMenuOpen} aria-label="user menu">
            <AccountCircleIcon />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={userMenuOpen}
            onClose={handleUserMenuClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            {user ? (
              <MenuItem disabled>
                <Typography variant="body2" color="text.secondary">
                  {user.username} ({user.role})
                </Typography>
              </MenuItem>
            ) : null}
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Logout
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {/* Sidebar Navigation */}
      <Drawer
        variant={drawerVariant}
        open={isMobile ? sidebarOpen : true}
        onClose={isMobile ? () => setSidebarOpen(false) : undefined}
        sx={{
          width: isMobile ? DRAWER_WIDTH : drawerWidth,
          flexShrink: 0,
          transition: isMobile ? undefined : 'width 225ms cubic-bezier(0.4, 0, 0.6, 1)',
          '& .MuiDrawer-paper': {
            width: isMobile ? DRAWER_WIDTH : drawerWidth,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            transition: isMobile ? undefined : 'width 225ms cubic-bezier(0.4, 0, 0.6, 1)',
            borderRight: 1,
            borderColor: 'divider',
            backgroundColor: 'background.paper',
          },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Main Content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: 3,
          mt: 8,
          backgroundColor: 'background.default',
        }}
      >
        <Outlet />
      </Box>
      <KeyboardShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </Box>
  );
}
