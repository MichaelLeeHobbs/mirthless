import { useState, useCallback, type ReactNode, type MouseEvent } from 'react';
import { Outlet, useNavigate, useLocation, Link as RouterLink } from 'react-router';
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
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LockResetIcon from '@mui/icons-material/LockReset';
import InfoIcon from '@mui/icons-material/Info';
import LogoutIcon from '@mui/icons-material/Logout';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import { useAuthStore } from '../../stores/auth.store.js';
import { useUiStore } from '../../stores/ui.store.js';
import { useSocketConnection } from '../../hooks/use-socket.js';
import { useKeyboardShortcuts } from '../../hooks/use-keyboard-shortcuts.js';
import { usePermissions } from '../../hooks/use-permissions.js';
import { NAV_SECTIONS } from './nav-items.js';
import { KeyboardShortcutHelp } from '../common/KeyboardShortcutHelp.js';
import { CommandPalette } from './CommandPalette.js';
import { JumpToButton } from './JumpToButton.js';
import { HeaderBreadcrumbs } from './HeaderBreadcrumbs.js';
import { ChangePasswordDialog } from '../account/ChangePasswordDialog.js';
import { AboutDialog } from '../account/AboutDialog.js';

const DRAWER_WIDTH = 240;
const COLLAPSED_DRAWER_WIDTH = 64;

export function AppLayout(): ReactNode {
  useSocketConnection();

  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clearAuth);
  const mustChangePassword = useAuthStore((state) => state.mustChangePassword);
  const { hasAny } = usePermissions();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const [mobileOpen, setMobileOpen] = useState(false);
  const themeMode = useUiStore((state) => state.themeMode);
  const toggleThemeMode = useUiStore((state) => state.toggleThemeMode);

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const userMenuOpen = Boolean(anchorEl);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const handleHelpOpen = useCallback(() => { setShortcutHelpOpen(true); }, []);
  const handlePaletteOpen = useCallback(() => { setPaletteOpen(true); }, []);
  const handlePaletteClose = useCallback(() => { setPaletteOpen(false); }, []);
  useKeyboardShortcuts({ onHelpOpen: handleHelpOpen, onPaletteOpen: handlePaletteOpen });

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
      setMobileOpen(false);
    }
  };

  // On phones the drawer is a temporary overlay that starts closed and always
  // shows labels; the store's sidebarOpen only collapses the desktop rail.
  const expanded = isMobile || sidebarOpen;
  const drawerWidth = sidebarOpen ? DRAWER_WIDTH : COLLAPSED_DRAWER_WIDTH;
  const drawerVariant = isMobile ? 'temporary' as const : 'permanent' as const;

  const visibleSections = NAV_SECTIONS
    .map((section) => ({
      heading: section.heading,
      items: section.items.filter((item) => (item.anyOf ? hasAny(item.anyOf) : true)),
    }))
    .filter((section) => section.items.length > 0);

  const drawerContent = (
    <>
      <Toolbar />
      <List sx={{ pt: 1 }}>
        {visibleSections.map((section) => (
          <Box key={section.heading}>
            {expanded ? (
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
                    mx: 1,
                    mb: 0.25,
                    borderRadius: 1.5,
                    justifyContent: expanded ? 'initial' : 'center',
                    px: expanded ? 1.5 : 1.25,
                    '&.Mui-selected': {
                      backgroundColor: 'action.selected',
                      '&:hover': { backgroundColor: 'action.selected' },
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 0,
                      mr: expanded ? 1.75 : 'auto',
                      justifyContent: 'center',
                      color: isActive ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {expanded ? (
                    <ListItemText
                      primary={item.label}
                      slotProps={{
                        primary: {
                          noWrap: true,
                          sx: {
                            fontSize: '0.875rem',
                            fontWeight: isActive ? 600 : 500,
                            color: isActive ? 'text.primary' : 'text.secondary',
                          },
                        }
                      }}
                    />
                  ) : null}
                </ListItemButton>
              );
              return expanded ? button : (
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
          // AppBar's default colour is primary.contrastText (white), which
          // vanishes on the light paper background.
          color: 'text.primary',
          borderBottom: 1,
          borderColor: 'divider',
        }}
        elevation={0}
      >
        <Toolbar
          sx={{
            // Three columns keep "Jump to" centred in the bar whatever the trail's
            // length; on a phone it joins the icons on the right.
            display: 'grid',
            gridTemplateColumns: isMobile ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto minmax(0, 1fr)',
            columnGap: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
            <IconButton
              edge="start"
              color="inherit"
              aria-label="toggle sidebar"
              onClick={isMobile ? () => setMobileOpen((open) => !open) : toggleSidebar}
              sx={{ mr: 0.75 }}
            >
              <MenuIcon />
            </IconButton>
            <Box
              sx={{
                display: { xs: 'none', sm: 'inline-flex' },
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                width: 30,
                height: 30,
                borderRadius: 1.5,
                color: 'primary.contrastText',
                bgcolor: 'primary.main',
              }}
            >
              <MonitorHeartIcon sx={{ fontSize: 20 }} />
            </Box>
            <Typography
              variant="h6"
              component="div"
              sx={{ display: { xs: 'none', lg: 'block' }, fontWeight: 700, letterSpacing: '-0.01em', color: 'text.primary' }}
            >
              GalvaniFlow
            </Typography>
            <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', lg: 'block' }, my: 2, mx: 0.5 }} />
            <HeaderBreadcrumbs compact={isMobile} />
          </Box>
          {isMobile ? null : <JumpToButton compact={false} onClick={handlePaletteOpen} />}
          <Box sx={{ display: 'flex', alignItems: 'center', justifySelf: 'end' }}>
            {isMobile ? <JumpToButton compact onClick={handlePaletteOpen} /> : null}
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
                  <Typography variant="body2" sx={{
                    color: 'text.secondary'
                  }}>
                    {user.username} ({user.role})
                  </Typography>
                </MenuItem>
              ) : null}
              <Divider />
              <MenuItem onClick={() => { handleUserMenuClose(); setChangePasswordOpen(true); }}>
                <ListItemIcon>
                  <LockResetIcon fontSize="small" />
                </ListItemIcon>
                Change Password
              </MenuItem>
              <MenuItem onClick={() => { handleUserMenuClose(); setAboutOpen(true); }}>
                <ListItemIcon>
                  <InfoIcon fontSize="small" />
                </ListItemIcon>
                About
              </MenuItem>
              <Divider />
              <MenuItem onClick={handleLogout}>
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                Logout
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </AppBar>

      {/* Sidebar Navigation */}
      <Drawer
        variant={drawerVariant}
        open={isMobile ? mobileOpen : true}
        onClose={isMobile ? () => setMobileOpen(false) : undefined}
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
      {paletteOpen ? <CommandPalette open onClose={handlePaletteClose} onShowShortcuts={handleHelpOpen} /> : null}
      <ChangePasswordDialog open={changePasswordOpen && !mustChangePassword} onClose={() => setChangePasswordOpen(false)} />
      {/* Mandatory password change blocks the app until completed. */}
      <ChangePasswordDialog forced open={mustChangePassword} onClose={() => { /* cleared via store on success */ }} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </Box>
  );
}
