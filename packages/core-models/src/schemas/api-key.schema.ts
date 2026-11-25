// API keys (D-313). The secret appears only in the answer to an issue or a replace.

import { z } from 'zod/v4';
import { PERMISSIONS, type Permission } from '../constants.js';
import { PERMISSION_CATALOG } from '../authz/catalog.js';
import { idSchema } from './id.schema.js';

export const KEY_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS).filter((p) => PERMISSION_CATALOG[p].keyAllowed);

const keyPermissionSchema = z.enum(KEY_PERMISSIONS as [Permission, ...Permission[]], {
  error: 'An API key cannot hold that permission.',
});

const reasonSchema = z.string().trim().min(3, 'Say why (at least 3 characters).').max(500)
  .refine((v) => !/[\r\n]/.test(v), 'The reason must be one line.');

export const createApiKeySchema = z.strictObject({
  name: z.string().trim().min(1, 'Name the key.').max(100),
  description: z.string().max(1000).default(''),
  permissions: z.array(keyPermissionSchema).min(1, 'Give the key at least one permission.').max(KEY_PERMISSIONS.length)
    .refine((list) => new Set(list).size === list.length, 'A permission is listed twice.'),
  /** null: every channel. */
  groupIds: z.array(idSchema).min(1).max(100)
    .refine((list) => new Set(list).size === list.length, 'A group is listed twice.')
    .nullable(),
  /** Required: every key ends. */
  expiresAt: z.string().datetime({ offset: true }),
  reason: reasonSchema.nullable().default(null),
}).superRefine((input, ctx) => {
  // A list being validated, not a principal's grants, so not holdsPermission.
  const readsMessages = input.permissions.some((p) => p === 'messages:read');
  if (input.groupIds === null && readsMessages && input.reason === null) {
    ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Say why this key reads every channel\'s messages.' });
  }
});

export const revokeApiKeySchema = z.strictObject({ reason: reasonSchema });

/** `leak` ends the old secret at once; `planned` keeps it 7 days or until the key ends (D-322). Replacing makes the caller the key's issuer. */
export const replaceApiKeySchema = z.strictObject({ mode: z.enum(['leak', 'planned']) });
export type ReplaceApiKeyInput = z.infer<typeof replaceApiKeySchema>;

export const setApiKeyEnabledSchema = z.strictObject({ enabled: z.boolean() });

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeySchema>;

export const API_KEY_STATUS = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
} as const;
export type ApiKeyStatus = (typeof API_KEY_STATUS)[keyof typeof API_KEY_STATUS];

/** Never carries the secret. */
export interface ApiKeyView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  /** null: every channel. */
  readonly groupIds: readonly string[] | null;
  readonly status: ApiKeyStatus;
  readonly expiresAt: string;
  readonly reason: string | null;
  readonly issuedBy: { readonly id: string; readonly username: string };
  readonly revokedAt: string | null;
  readonly revokeReason: string | null;
  readonly lastUsedAt: string | null;
  readonly lastUsedIp: string | null;
  readonly createdAt: string;
  /** After a planned replace, the old secret still works until this time. */
  readonly previousSecretUntil: string | null;
}

/** The token is shown this once. */
export interface IssuedApiKey {
  readonly key: ApiKeyView;
  /** gf_<keyId>_<secret>. The server keeps only the secret's hash. */
  readonly token: string;
}
