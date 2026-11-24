// Inserted only where the key is missing, so a changed default reaches no existing install.

import type { NewSystemSetting } from '../schema/index.js';

export const defaultSettings: readonly NewSystemSetting[] = [
  {
    key: 'general.server_name',
    value: 'GalvaniGraph',
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
  {
    key: 'smtp.host',
    value: '',
    type: 'string',
    category: 'smtp',
    description: 'SMTP server hostname',
  },
  {
    key: 'smtp.port',
    value: '587',
    type: 'number',
    category: 'smtp',
    description: 'SMTP server port',
  },
  {
    key: 'smtp.secure',
    value: 'false',
    type: 'boolean',
    category: 'smtp',
    description: 'Use TLS for SMTP connection',
  },
  {
    key: 'smtp.require_tls',
    value: 'false',
    type: 'boolean',
    category: 'smtp',
    description: 'Require STARTTLS before signing in or sending',
  },
  {
    key: 'smtp.from',
    value: '',
    type: 'string',
    category: 'smtp',
    description: 'Default sender email address',
  },
  {
    key: 'smtp.auth_user',
    value: '',
    type: 'string',
    category: 'smtp',
    description: 'SMTP authentication username',
  },
  {
    key: 'smtp.auth_pass',
    value: '',
    type: 'password',
    category: 'smtp',
    description: 'SMTP authentication password',
  },
  {
    key: 'pruner.enabled',
    value: 'false',
    type: 'boolean',
    category: 'pruner',
    description: 'Enable automatic data pruning on schedule',
  },
  {
    key: 'pruner.cron_expression',
    value: '0 3 * * *',
    type: 'string',
    category: 'pruner',
    description: 'Cron expression for data pruner schedule (default: 3 AM daily)',
  },
  // Audit log (D-312). drop_expired_audit_partitions() reads it and never keeps less than 6.
  {
    key: 'audit.retention_years',
    value: '6',
    type: 'number',
    category: 'audit',
    description: 'Years of audit log kept before its months can be dropped (minimum 6)',
  },
];
