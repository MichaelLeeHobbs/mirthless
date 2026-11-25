import { z } from 'zod/v4';

type WithoutDefault<T extends z.core.$ZodType> = T extends z.ZodDefault<infer Inner extends z.core.$ZodType> | z.ZodPrefault<infer Inner extends z.core.$ZodType> ? Inner : T;

type WithoutDefaults<Shape extends z.ZodRawShape> = { [Key in keyof Shape]: WithoutDefault<Shape[Key]> };

/**
 * For the schema of an update: `.partial()` keeps the defaults, and Zod fills one in for each field the
 * request leaves out, which the server then writes over what is stored (#400, D-358).
 */
export function withoutDefaults<Shape extends z.ZodRawShape>(schema: z.ZodObject<Shape>): z.ZodObject<WithoutDefaults<Shape>> {
  const fields = Object.entries(schema.shape).map(([key, field]) =>
    [key, field instanceof z.ZodDefault || field instanceof z.ZodPrefault ? field.unwrap() : field] as const);
  return z.object(Object.fromEntries(fields) as WithoutDefaults<Shape>);
}
