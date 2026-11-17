// ===========================================
// Permission Catalog
// ===========================================
// What each permission is, for the role editor, the assignment picker and the
// access views, and the rules that decide where it may be held (D-310, RBAC
// plan section 1). The permission list itself stays PERMISSIONS in
// constants.ts (D-268).

import type { Permission } from '../constants.js';

/** Where a permission may be held. */
export const PERMISSION_CLASS = {
  /** Scoped by the assignment: a channel's own data and actions. */
  CHANNEL: 'channel',
  /** Reads that cannot hold PHI: any assignment, scoped or not. */
  SYSTEM_READ: 'system-read',
  /** Reads of data from every channel: all-channel assignments only, keys included. */
  EVERY_CHANNEL_READ: 'every-channel-read',
  /** System-wide writes: all-channel assignments only. */
  TRUST: 'trust',
  /** Users, roles, keys, the audit log, backup and restore: all-channel only, never on a key. */
  IDENTITY: 'identity',
} as const;
export type PermissionClass = (typeof PERMISSION_CLASS)[keyof typeof PERMISSION_CLASS];

export interface PermissionInfo {
  readonly label: string;
  readonly area: string;
  readonly description: string;
  readonly class: PermissionClass;
  /** Whether an API key may hold it. */
  readonly keyAllowed: boolean;
  /**
   * Its holder can make the server run code they wrote. That code reaches every
   * channel's messages and credentials whatever the holder's scope (RBAC plan,
   * "what scope promises").
   */
  readonly runsCode: boolean;
  /**
   * As strong as admin: its holder can change who holds which permission,
   * themselves included, up to everything they hold (the within rule).
   */
  readonly adminEquivalent: boolean;
  /** Its holder can read message content or other PHI, or send it somewhere they choose. */
  readonly readsPhi: boolean;
  /** Returns data from every channel, whatever the holder's scope. */
  readonly readsEveryChannel: boolean;
}

const { CHANNEL, SYSTEM_READ, EVERY_CHANNEL_READ, TRUST, IDENTITY } = PERMISSION_CLASS;

interface Flags {
  readonly runsCode?: boolean;
  readonly adminEquivalent?: boolean;
  readonly readsPhi?: boolean;
  /** For an identity permission that returns every channel's data; every-channel-read implies it. */
  readonly readsEveryChannel?: boolean;
}

function info(area: string, label: string, description: string, cls: PermissionClass, flags: Flags = {}): PermissionInfo {
  return {
    label, area, description, class: cls,
    keyAllowed: cls !== IDENTITY,
    runsCode: flags.runsCode ?? false,
    adminEquivalent: flags.adminEquivalent ?? false,
    readsPhi: flags.readsPhi ?? false,
    readsEveryChannel: cls === EVERY_CHANNEL_READ || (flags.readsEveryChannel ?? false),
  };
}

const CODE = { runsCode: true } as const;
const PHI = { readsPhi: true } as const;

export const PERMISSION_CATALOG: Readonly<Record<Permission, PermissionInfo>> = {
  'channels:read': info('Channels', 'Read channels', 'See channels, their settings and their statistics.', CHANNEL),
  'channels:write': info('Channels', 'Change channels', 'Create, edit and clone channels, including their scripts and connector credentials.', CHANNEL, CODE),
  'channels:deploy': info('Channels', 'Deploy channels', 'Deploy, start, stop and send test messages; deployed code runs on the server.', CHANNEL, CODE),
  'channels:delete': info('Channels', 'Delete channels', 'Delete channels and all their messages.', CHANNEL),
  'messages:read': info('Messages', 'Read messages', 'Search, view and export message content and attachments.', CHANNEL, PHI),
  'messages:reprocess': info('Messages', 'Reprocess messages', 'Reprocess messages and resend them to destinations.', CHANNEL, PHI),
  'messages:delete': info('Messages', 'Delete messages', 'Delete messages and their content.', CHANNEL),
  'code_templates:read': info('Code templates', 'Read code templates', 'See code template libraries and their code.', SYSTEM_READ),
  'code_templates:write': info('Code templates', 'Change code templates', 'Edit templates compiled into the channels a library is linked to.', CHANNEL, CODE),
  'code_templates:delete': info('Code templates', 'Delete code templates', 'Delete templates and libraries.', CHANNEL),
  'alerts:read': info('Alerts', 'Read alerts', 'See alerts, their triggers and recipients.', SYSTEM_READ),
  'alerts:write': info('Alerts', 'Change alerts', 'Create and edit alerts, which can email message details anywhere.', TRUST, PHI),
  'alerts:delete': info('Alerts', 'Delete alerts', 'Delete alerts.', TRUST),
  'users:read': info('Users', 'Read users', "See users and the access they hold.", IDENTITY),
  'users:write': info('Users', 'Change users', 'Create and edit users, reset passwords and unlock accounts.', IDENTITY, { adminEquivalent: true }),
  'users:delete': info('Users', 'Delete users', 'Delete users.', IDENTITY),
  'settings:read': info('Settings', 'Read settings', 'See server settings, certificates, tags and extensions. Secrets are masked.', SYSTEM_READ),
  'settings:write': info('Settings', 'Change settings', 'Change server settings, certificates, tags, the pruner, and purge events.', TRUST),
  'events:read': info('Events', 'Read events', 'See and export the events table: configuration changes and engine events.', CHANNEL),
  'resources:read': info('Resources', 'Read resources', 'See resources, which every channel\'s scripts read by name.', SYSTEM_READ),
  'resources:write': info('Resources', 'Change resources', 'Change resources that every channel\'s scripts read.', TRUST, CODE),
  'resources:delete': info('Resources', 'Delete resources', 'Delete resources.', TRUST),
  'collections:read': info('Collections', 'Read collections', 'Read collection records, which can hold PHI from any channel.', EVERY_CHANNEL_READ, PHI),
  'collections:write': info('Collections', 'Change collections', 'Add and change records that running channels read.', TRUST),
  'collections:delete': info('Collections', 'Delete collections', 'Delete collections and records.', TRUST),
  'datasources:read': info('Data sources', 'Read data sources', 'See data source settings. Passwords are never returned.', SYSTEM_READ),
  'datasources:write': info('Data sources', 'Change data sources', 'Change the databases any channel\'s dbQuery reaches.', TRUST),
  'datasources:delete': info('Data sources', 'Delete data sources', 'Delete data sources.', TRUST),
  'global_scripts:read': info('Global scripts', 'Read global scripts', 'See the scripts compiled into every channel.', SYSTEM_READ),
  'global_scripts:write': info('Global scripts', 'Change global scripts', 'Change scripts that run in every channel.', TRUST, CODE),
  'global_map:read': info('Global map', 'Read the global map', 'Read values scripts store for every channel, often PHI or credentials.', EVERY_CHANNEL_READ, PHI),
  'global_map:write': info('Global map', 'Change the global map', 'Change values every channel\'s scripts read.', TRUST),
  'config_map:read': info('Configuration map', 'Read the configuration map', 'Read configuration values, which often hold credentials.', EVERY_CHANNEL_READ),
  'config_map:write': info('Configuration map', 'Change the configuration map', 'Change values channels read at deploy, which can redirect any channel.', TRUST),
  'system:info': info('System', 'Read system information', 'See server health, the server log and metrics. Log lines can hold PHI.', EVERY_CHANNEL_READ, PHI),
  'system:backup': info('System', 'Download backups', 'Download the server configuration, which holds scripts, both maps and users.', IDENTITY, { readsPhi: true, readsEveryChannel: true }),
  'system:restore': info('System', 'Restore backups', 'Overwrite channels, templates and scripts from a file; restored code runs at the next deploy.', IDENTITY, CODE),
  'roles:read': info('Roles', 'Read roles', 'See roles, their permissions and how many users hold each.', IDENTITY),
  'roles:write': info('Roles', 'Change roles', 'Create, edit, clone and delete roles. A change to a role changes what everyone holding it may do.', IDENTITY, { adminEquivalent: true }),
  'api_keys:read': info('API keys', 'Read API keys', 'See API keys: who issued them, what they hold, when they end and when they were last used. Never their secrets.', IDENTITY),
  'api_keys:manage': info('API keys', 'Manage API keys', 'Issue, replace, enable, disable and revoke API keys. A key holds at most what its issuer holds.', IDENTITY),
  'audit:read': info('Audit', 'Read the audit log', 'Read the protected audit log: sign-ins, PHI reads, refusals and grant changes.', IDENTITY, { readsEveryChannel: true }),
};

/** Whether `permission` may be held only through an all-channel assignment. */
export function allChannelsOnly(permission: Permission): boolean {
  const cls = PERMISSION_CATALOG[permission].class;
  return cls === EVERY_CHANNEL_READ || cls === TRUST || cls === IDENTITY;
}
