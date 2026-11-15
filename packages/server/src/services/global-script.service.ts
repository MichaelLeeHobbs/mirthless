// ===========================================
// Global Script Service
// ===========================================
// Business logic for global scripts (deploy, undeploy, preprocessor, postprocessor).
// All methods return Result<T> using tryCatch from stderr-lib.

import { assertScriptCompiles } from './script-validation.service.js';
import { tryCatch, type Result } from 'stderr-lib';
import { eq } from 'drizzle-orm';
import type { ScriptLanguageCode, UpdateGlobalScriptsInput } from '@galvaniflow/core-models';
import { DEFAULT_STORED_SCRIPT_LANGUAGE, GLOBAL_SCRIPT_TYPE, toScriptLanguage } from '@galvaniflow/core-models';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { globalScripts } from '../db/schema/index.js';

// ----- Response Types -----

type GlobalScriptKey = 'deploy' | 'undeploy' | 'preprocessor' | 'postprocessor';

export interface GlobalScriptsData {
  readonly deploy: string;
  readonly undeploy: string;
  readonly preprocessor: string;
  readonly postprocessor: string;
  /** The language each script is written in. */
  readonly languages: Readonly<Record<GlobalScriptKey, ScriptLanguageCode>>;
}

const ENTRIES: ReadonlyArray<{ readonly key: string; readonly field: GlobalScriptKey }> = [
  { key: GLOBAL_SCRIPT_TYPE.DEPLOY, field: 'deploy' },
  { key: GLOBAL_SCRIPT_TYPE.UNDEPLOY, field: 'undeploy' },
  { key: GLOBAL_SCRIPT_TYPE.PREPROCESSOR, field: 'preprocessor' },
  { key: GLOBAL_SCRIPT_TYPE.POSTPROCESSOR, field: 'postprocessor' },
];

/** Read every global script, with empty strings for missing rows. */
async function readAll(): Promise<GlobalScriptsData> {
  const rows = await db.select().from(globalScripts);
  const byType = new Map(rows.map((r) => [r.scriptType, r]));
  const script = (key: string): string => byType.get(key)?.script ?? '';
  const language = (key: string): ScriptLanguageCode => toScriptLanguage(byType.get(key)?.language);
  return {
    deploy: script(GLOBAL_SCRIPT_TYPE.DEPLOY),
    undeploy: script(GLOBAL_SCRIPT_TYPE.UNDEPLOY),
    preprocessor: script(GLOBAL_SCRIPT_TYPE.PREPROCESSOR),
    postprocessor: script(GLOBAL_SCRIPT_TYPE.POSTPROCESSOR),
    languages: {
      deploy: language(GLOBAL_SCRIPT_TYPE.DEPLOY),
      undeploy: language(GLOBAL_SCRIPT_TYPE.UNDEPLOY),
      preprocessor: language(GLOBAL_SCRIPT_TYPE.PREPROCESSOR),
      postprocessor: language(GLOBAL_SCRIPT_TYPE.POSTPROCESSOR),
    },
  };
}

// ----- Service -----

export class GlobalScriptService {
  /** Get all 4 global scripts. Returns empty strings for missing rows. */
  static async getAll(): Promise<Result<GlobalScriptsData>> {
    return tryCatch(readAll);
  }

  /**
   * Update global scripts (upserts only provided fields). A script that does
   * not compile is refused; TypeScript type errors are allowed here and block
   * deploys instead.
   */
  static async update(
    input: UpdateGlobalScriptsInput,
    context?: AuditContext,
  ): Promise<Result<GlobalScriptsData>> {
    return tryCatch(async () => {
      // Check every script before saving any, so a bad one changes nothing.
      for (const entry of ENTRIES) {
        const value = input[entry.field];
        if (value !== undefined) await assertScriptCompiles(value, `The global ${entry.field} script`);
      }

      for (const entry of ENTRIES) {
        const value = input[entry.field];
        const language = input.languages?.[entry.field];
        if (value === undefined && language === undefined) continue;

        const [existing] = await db
          .select({ scriptType: globalScripts.scriptType })
          .from(globalScripts)
          .where(eq(globalScripts.scriptType, entry.key));

        if (existing) {
          await db
            .update(globalScripts)
            .set({
              ...(value !== undefined ? { script: value } : {}),
              ...(language !== undefined ? { language } : {}),
              updatedAt: new Date(),
            })
            .where(eq(globalScripts.scriptType, entry.key));
        } else {
          await db
            .insert(globalScripts)
            .values({ scriptType: entry.key, script: value ?? '', language: language ?? DEFAULT_STORED_SCRIPT_LANGUAGE });
        }
      }

      emitEvent({
        level: 'INFO', name: 'GLOBAL_SCRIPT_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { updatedScripts: ENTRIES.map((e) => e.field).filter((f) => input[f] !== undefined || input.languages?.[f] !== undefined) },
      });

      return readAll();
    });
  }
}
