// ===========================================
// Default System Settings
// ===========================================
// These are seeded on first run. Values can be changed via Admin UI.

import type { NewSystemSetting } from '../schema/index.js';

export const defaultSettings: readonly NewSystemSetting[] = [
  {
    key: 'general.server_name',
    value: 'Mirthless',
    type: 'string',
    category: 'general',
    description: 'Display name for this server instance',
  },
  {
    key: 'general.default_admin_address',
    value: '',
    type: 'string',
    category: 'general',
    description: 'Default admin email address for system notifications',
  },
  {
    key: 'features.maintenance_mode',
    value: 'false',
    type: 'boolean',
    category: 'features',
    description: 'Enable maintenance mode (blocks non-admin access)',
  },
];
