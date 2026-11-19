// The Settings page is built from this list: a new setting needs one entry here.

import { SETTING_TYPE, type SettingType } from '@galvanigraph/core-models';
import { humanize } from './format.js';

export type SettingCheck = 'port' | 'email' | 'cron' | 'retentionYears';

/** The least audit retention, in years (D-312). The database function enforces it too. */
export const MIN_AUDIT_RETENTION_YEARS = 6;

export interface SettingField {
  readonly key: string;
  readonly label: string;
  readonly help: string;
  readonly check?: SettingCheck;
  readonly placeholder?: string;
}

export interface SettingSection {
  readonly id: string;
  readonly label: string;
  readonly intro: string;
  readonly fields: readonly SettingField[];
}

export const SETTING_SECTIONS: readonly SettingSection[] = [
  {
    id: 'general',
    label: 'General',
    intro: 'How this server identifies itself.',
    fields: [
      { key: 'general.server_name', label: 'Server name', help: 'A display name for this server, so people can tell instances apart.' },
      {
        key: 'general.default_admin_address',
        label: 'Admin email',
        help: 'Where system notifications go when nothing more specific is set.',
        check: 'email',
        placeholder: 'ops@hospital.example',
      },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    intro: 'The mail server alerts use to send email. A change applies to the next email sent.',
    fields: [
      { key: 'smtp.host', label: 'SMTP server', help: 'Host name of the outgoing mail server. Email alerts fail while this is empty.', placeholder: 'smtp.hospital.example' },
      { key: 'smtp.port', label: 'Port', help: 'Usually 587 for STARTTLS, 465 for TLS, or 25 for plain SMTP.', check: 'port' },
      { key: 'smtp.secure', label: 'Use TLS', help: 'Connect with TLS from the start. Turn on for port 465.' },
      { key: 'smtp.from', label: 'From address', help: 'The sender address on every email.', check: 'email', placeholder: 'galvanigraph@hospital.example' },
      { key: 'smtp.auth_user', label: 'Username', help: 'Leave empty if the server does not need a sign-in.' },
      { key: 'smtp.auth_pass', label: 'Password', help: 'Write-only: once saved it is never shown again. Type a new one to replace it.' },
    ],
  },
  {
    id: 'pruner',
    label: 'Data pruning',
    intro: "Deletes old messages on a schedule. Each channel's own pruning settings decide what counts as old.",
    fields: [
      { key: 'pruner.enabled', label: 'Prune on a schedule', help: 'Run the data pruner automatically.' },
      {
        key: 'pruner.cron_expression',
        label: 'Schedule',
        help: 'A cron expression: minute, hour, day of month, month, day of week. "0 3 * * *" is 3 AM daily.',
        check: 'cron',
      },
    ],
  },
  {
    id: 'audit',
    label: 'Audit log',
    intro: 'The protected record of who read PHI and who changed access. Nothing in the product can change or delete it.',
    fields: [
      {
        key: 'audit.retention_years',
        label: 'Keep for (years)',
        help: 'How long audit months are kept before the database owner may drop them. Never less than 6; dropping is a manual step for the database owner.',
        check: 'retentionYears',
      },
    ],
  },
  {
    id: 'features',
    label: 'Maintenance',
    intro: 'Switches for planned downtime.',
    fields: [
      {
        key: 'features.maintenance_mode',
        label: 'Maintenance mode',
        help: 'Meant to block non-admin access. Not enforced yet: turning it on is stored but blocks no one.',
      },
    ],
  },
];

/** Saving these must also reschedule the pruner. */
export const PRUNER_KEYS = { enabled: 'pruner.enabled', cron: 'pruner.cron_expression' } as const;

/** The value the server sends in place of a stored secret. */
export const REDACTED = '__REDACTED__';

const FIELD_BY_KEY: ReadonlyMap<string, SettingField> = new Map(
  SETTING_SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, f] as const)),
);

export function fieldFor(key: string): SettingField {
  const known = FIELD_BY_KEY.get(key);
  if (known) return known;
  const name = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
  return { key, label: humanize(name), help: '' };
}

export { isSecretSetting as isSecret } from '@galvanigraph/core-util';

const SAVE_TYPES: ReadonlySet<string> = new Set(Object.values(SETTING_TYPE));

/**
 * A stored type can be any short string (an older database or a restore may hold
 * `secret` or `Password`), but one type the save API does not know fails the
 * whole bulk save. The server treats `secret` and `password` both as secret.
 */
export function settingTypeForSave(type: string): SettingType {
  const lower = type.toLowerCase();
  if (lower === 'secret') return SETTING_TYPE.PASSWORD;
  return SAVE_TYPES.has(lower) ? (lower as SettingType) : SETTING_TYPE.STRING;
}

interface Keyed { readonly key: string }

export interface GroupedSection<T extends Keyed> {
  readonly section: SettingSection;
  readonly settings: readonly T[];
}

export function groupSettings<T extends Keyed>(settings: readonly T[]): readonly GroupedSection<T>[] {
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const groups: GroupedSection<T>[] = [];
  for (const section of SETTING_SECTIONS) {
    const found = section.fields.flatMap((f) => byKey.get(f.key) ?? []);
    if (found.length > 0) groups.push({ section, settings: found });
  }
  const other = settings.filter((s) => !FIELD_BY_KEY.has(s.key));
  if (other.length > 0) {
    groups.push({ section: { id: 'other', label: 'Other', intro: 'Settings this page has no description for yet.', fields: [] }, settings: other });
  }
  return groups;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CRON_FIELD_RE = /^[\d*,/?LW#-]+$|^[A-Za-z]{3}(-[A-Za-z]{3})?$/;

function checkCron(value: string): string | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) return 'Needs 5 fields: minute hour day month weekday.';
  return parts.every((p) => CRON_FIELD_RE.test(p)) ? null : 'One of the fields is not valid cron syntax.';
}

function checkNumber(value: string, check: SettingCheck | undefined): string | null {
  if (value.trim() === '' || !Number.isFinite(Number(value))) return 'Enter a number.';
  const n = Number(value);
  if (check === 'retentionYears') {
    return Number.isInteger(n) && n >= MIN_AUDIT_RETENTION_YEARS && n <= 999 ? null : `Enter whole years, at least ${String(MIN_AUDIT_RETENTION_YEARS)}.`;
  }
  if (check !== 'port') return null;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : 'Enter a port from 1 to 65535.';
}

function checkJson(value: string): string | null {
  if (value.trim() === '') return null;
  try {
    JSON.parse(value);
    return null;
  } catch {
    return 'Not valid JSON.';
  }
}

export function validateSetting(type: string, value: string, check?: SettingCheck): string | null {
  if (type === 'number') return checkNumber(value, check);
  if (type === 'json') return checkJson(value);
  if (check === 'email') return value.trim() === '' || EMAIL_RE.test(value.trim()) ? null : 'Enter an email address.';
  if (check === 'cron') return checkCron(value);
  return null;
}
