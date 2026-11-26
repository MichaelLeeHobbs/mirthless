import type { z } from 'zod/v4';

/** What deploy would refuse in a data type's settings, read with the schema deploy checks. */
export function settingsProblem(schema: z.ZodType, settings: Readonly<Record<string, unknown>>): string | undefined {
  const parsed = schema.safeParse(settings);
  return parsed.success ? undefined : parsed.error.issues.map((i) => i.message).join('; ');
}
