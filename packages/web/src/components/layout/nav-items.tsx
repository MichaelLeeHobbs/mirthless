// ===========================================
// Navigation Items
// ===========================================
// The sidebar's pages, grouped by section. The command palette reads the same
// list, so a page added here shows up in both places.

import type { ReactNode } from 'react';
import DashboardIcon from '@mui/icons-material/Dashboard';
import MessageIcon from '@mui/icons-material/Message';
import CodeIcon from '@mui/icons-material/Code';
import NotificationsIcon from '@mui/icons-material/Notifications';
import EventIcon from '@mui/icons-material/Event';
import PeopleIcon from '@mui/icons-material/People';
import JavascriptIcon from '@mui/icons-material/Javascript';
import SettingsIcon from '@mui/icons-material/Settings';
import FolderIcon from '@mui/icons-material/Folder';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import StorageIcon from '@mui/icons-material/Storage';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import TuneIcon from '@mui/icons-material/Tune';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import BuildIcon from '@mui/icons-material/Build';
import ExtensionIcon from '@mui/icons-material/Extension';
import SecurityIcon from '@mui/icons-material/Security';
import { PERMISSION, type PermissionString } from '../../lib/permissions.js';

export interface NavItem {
  readonly label: string;
  readonly path: string;
  readonly icon: ReactNode;
  /** If set, the item is shown only when the user holds one of these permissions. */
  readonly anyOf?: readonly PermissionString[];
}

export interface NavSection {
  readonly heading: string;
  readonly items: readonly NavItem[];
}

/** Sidebar sections in display order. */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    heading: 'Overview',
    items: [
      { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
      { label: 'Traffic', path: '/messages', icon: <MessageIcon /> },
    ],
  },
  {
    heading: 'Channels',
    items: [
      { label: 'Tags', path: '/tags', icon: <LocalOfferIcon /> },
      { label: 'Code Templates', path: '/code-templates', icon: <CodeIcon />, anyOf: [PERMISSION.CODE_TEMPLATES_READ] },
      { label: 'Global Scripts', path: '/global-scripts', icon: <JavascriptIcon />, anyOf: [PERMISSION.GLOBAL_SCRIPTS_READ] },
      { label: 'Resources', path: '/resources', icon: <FolderIcon />, anyOf: [PERMISSION.RESOURCES_READ] },
      { label: 'Collections', path: '/collections', icon: <Inventory2Icon />, anyOf: [PERMISSION.COLLECTIONS_READ] },
      { label: 'Data Sources', path: '/datasources', icon: <StorageIcon />, anyOf: [PERMISSION.DATASOURCES_READ] },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      { label: 'Alerts', path: '/alerts', icon: <NotificationsIcon />, anyOf: [PERMISSION.ALERTS_READ] },
      { label: 'Settings', path: '/settings', icon: <SettingsIcon />, anyOf: [PERMISSION.SETTINGS_READ, PERMISSION.SETTINGS_WRITE] },
      { label: 'Global Map', path: '/global-map', icon: <StorageIcon />, anyOf: [PERMISSION.GLOBAL_MAP_READ] },
      { label: 'Config Map', path: '/config-map', icon: <TuneIcon />, anyOf: [PERMISSION.CONFIG_MAP_READ] },
      { label: 'Certificates', path: '/certificates', icon: <SecurityIcon />, anyOf: [PERMISSION.SETTINGS_READ, PERMISSION.SETTINGS_WRITE] },
    ],
  },
  {
    heading: 'Administration',
    items: [
      { label: 'Users', path: '/users', icon: <PeopleIcon />, anyOf: [PERMISSION.USERS_READ] },
      { label: 'Events', path: '/events', icon: <EventIcon />, anyOf: [PERMISSION.EVENTS_READ] },
    ],
  },
  {
    heading: 'System',
    items: [
      { label: 'System Info', path: '/system', icon: <InfoOutlinedIcon />, anyOf: [PERMISSION.SYSTEM_INFO] },
      { label: 'Tools', path: '/tools/message-generator', icon: <BuildIcon /> },
      { label: 'Extensions', path: '/extensions', icon: <ExtensionIcon />, anyOf: [PERMISSION.SETTINGS_READ, PERMISSION.SETTINGS_WRITE] },
    ],
  },
];
