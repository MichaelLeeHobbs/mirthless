import { z } from 'zod/v4';

export const ALERT_TRIGGER_TYPES = ['CHANNEL_ERROR', 'NO_MESSAGES'] as const;

export const ERROR_EVENT_TYPES = [
  'ANY',
  'SOURCE_CONNECTOR',
  'DESTINATION_CONNECTOR',
  'SOURCE_FILTER',
  'SOURCE_TRANSFORMER',
  'DESTINATION_FILTER',
  'DESTINATION_TRANSFORMER',
  'PREPROCESSOR_SCRIPT',
  'POSTPROCESSOR_SCRIPT',
  'DEPLOY_SCRIPT',
  'UNDEPLOY_SCRIPT',
] as const;

export const ALERT_ACTION_TYPES = ['EMAIL', 'CHANNEL'] as const;

/** Why the pattern does not compile, or null when it does. */
export function alertRegexError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Refused at save, because a pattern that does not compile never matches and its alert never fires. */
const alertRegexSchema = z.string().superRefine((pattern, ctx) => {
  const message = alertRegexError(pattern);
  if (message !== null) ctx.addIssue({ code: 'custom', message });
});

export const channelErrorTriggerSchema = z.object({
  type: z.literal('CHANNEL_ERROR'),
  errorTypes: z.array(z.enum(ERROR_EVENT_TYPES)).min(1),
  regex: alertRegexSchema.nullable().default(null),
});

export const noMessagesTriggerSchema = z.object({
  type: z.literal('NO_MESSAGES'),
  windowMinutes: z.number().int().min(1).max(10_080),
});

export const alertTriggerSchema = z.discriminatedUnion('type', [
  channelErrorTriggerSchema,
  noMessagesTriggerSchema,
]);

export type AlertTriggerInput = z.infer<typeof alertTriggerSchema>;

export const alertActionInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('EMAIL'),
    recipients: z.array(z.string().email()).min(1),
  }),
  z.object({
    type: z.literal('CHANNEL'),
    channelId: z.string().uuid(),
    recipients: z.array(z.string()).default([]),
  }),
]);

export type AlertActionInput = z.infer<typeof alertActionInputSchema>;

export const createAlertSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().default(''),
  enabled: z.boolean().default(true),
  trigger: alertTriggerSchema,
  channelIds: z.array(z.string().uuid()).default([]),
  actions: z.array(alertActionInputSchema).default([]),
  subjectTemplate: z.string().nullable().default(null),
  bodyTemplate: z.string().nullable().default(null),
  reAlertIntervalMs: z.number().int().nonnegative().nullable().default(null),
  maxAlerts: z.number().int().positive().nullable().default(null),
});

export type CreateAlertInput = z.infer<typeof createAlertSchema>;

export const updateAlertSchema = createAlertSchema.partial().extend({
  revision: z.number().int().positive(),
});

export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;

export const alertListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

export type AlertListQuery = z.infer<typeof alertListQuerySchema>;

export const patchAlertEnabledSchema = z.object({
  enabled: z.boolean(),
});

export type PatchAlertEnabledInput = z.infer<typeof patchAlertEnabledSchema>;

export const alertUuidParamSchema = z.object({
  id: z.string().uuid(),
});
