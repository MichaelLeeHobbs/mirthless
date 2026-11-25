// An update keeps what the request leaves out, so its schema fills nothing in (#400, D-350).

import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import * as models from '../../index.js';

/** Where an update may fill something in, with why. */
const ALLOWED: ReadonlyMap<string, string> = new Map([
  ['updateChannelSchema.filters[].metaDataId', 'refused when given'],
  ['updateChannelSchema.transformers[].metaDataId', 'refused when given'],
  ['updateAlertSchema.actions[].recipients', 'a channel action sends to its channel'],
]);

interface Place {
  readonly schema: z.core.$ZodType;
  readonly path: string;
}

function childrenOf({ schema, path }: Place): readonly Place[] {
  const def = (schema as z.core.$ZodTypes)._zod.def;
  switch (def.type) {
    case 'object': return Object.entries(def.shape).map(([key, child]) => ({ schema: child, path: `${path}.${key}` }));
    case 'array': return [{ schema: def.element, path: `${path}[]` }];
    case 'record': return [{ schema: def.valueType, path: `${path}{}` }];
    case 'union': return def.options.map((child) => ({ schema: child, path }));
    case 'pipe': return [{ schema: def.in, path }, { schema: def.out, path }];
    case 'optional': case 'nullable': case 'nonoptional': case 'readonly': case 'default': case 'prefault': return [{ schema: def.innerType, path }];
    case 'string': case 'number': case 'boolean': case 'enum': case 'literal': case 'unknown': case 'transform': return [];
    default: throw new Error(`${path}: teach this test about ${def.type}`);
  }
}

function filledIn(name: string, schema: z.core.$ZodType): readonly string[] {
  const found: string[] = [];
  const open: Place[] = [{ schema, path: name }];
  for (let place = open.pop(); place !== undefined; place = open.pop()) {
    const { type } = place.schema._zod.def;
    if (type === 'default' || type === 'prefault') found.push(place.path);
    open.push(...childrenOf(place));
  }
  return found;
}

const updateSchemas = Object.entries<unknown>(models)
  .filter((entry): entry is [string, z.ZodType] => /^(update|upsert|bulkUpsert)\w*Schema$/.test(entry[0]) && entry[1] instanceof z.ZodType);

describe('update schemas', () => {
  it('finds them', () => {
    expect(updateSchemas.map(([name]) => name)).toEqual(expect.arrayContaining(['updateChannelSchema', 'updateAlertSchema', 'updateUserSchema', 'upsertSettingSchema', 'bulkUpsertSettingsSchema']));
  });

  it.each(updateSchemas)('%s fills in nothing that the request leaves out', (name, schema) => {
    expect(filledIn(name, schema).filter((path) => !ALLOWED.has(path))).toEqual([]);
  });

  it('allows no more than there is', () => {
    const all = new Set(updateSchemas.flatMap(([name, schema]) => filledIn(name, schema)));
    expect([...ALLOWED.keys()].filter((path) => !all.has(path))).toEqual([]);
  });
});
