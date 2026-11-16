// ===========================================
// Global Script Service
// ===========================================
// Business logic for global scripts (deploy, undeploy, preprocessor, postprocessor).
// All methods return Result<T> using tryCatch from stderr-lib.

import { assertScriptCompiles } from './script-validation.service.js';
import { assertGlobalScriptsTypeCheck } from './script-type-gate.service.js';
import { CodeTemplateService } from './code-template.service.js';
import { tryCatch, type Result } from 'stderr-lib';
import { eq } from 'drizzle-orm';
import type { ScriptLanguageCode, UpdateGlobalScriptsInput } from '@galvaniflow/core-models';
import { GLOBAL_SCRIPT_TYPE, toScriptLanguage } from '@galvaniflow/core-models';
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

/**
 * The language of a script never saved (no row): TypeScript, as the editor
 * starts every new script. A save that leaves the language out keeps it, so the
 * first save stores it too, the language the script was type-checked in (#228).
 */
const NEVER_SAVED_LANGUAGE: ScriptLanguageCode = 'TYPESCRIPT';

/**
 * Read every global script, with empty strings for missing rows. A saved
 * script keeps its language even when empty (#183).
 */
async function readAll(): Promise<GlobalScriptsData> {
  const rows = await db.select().from(globalScripts);
  const byType = new Map(rows.map((r) => [r.scriptType, r]));
  const script = (key: string): string => byType.get(key)?.script ?? '';
  const language = (key: string): ScriptLanguageCode => {
    const row = byType.get(key);
    return row ? toScriptLanguage(row.language) : NEVER_SAVED_LANGUAGE;
  };
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

/**
 * Type-check the scripts this save changes, as they will be after it (a
 * language switch alone counts). Nothing to do when none of them is TypeScript.
 */
async function assertTouchedScriptsTypeCheck(input: UpdateGlobalScriptsInput): Promise<void> {
  const touched = ENTRIES.map((e) => e.field).filter((f) => input[f] !== undefined || input.languages?.[f] !== undefined);
  if (touched.length === 0) return;
  const current = await readAll();
  const next: GlobalScriptsData = {
    deploy: input.deploy ?? current.deploy,
    undeploy: input.undeploy ?? current.undeploy,
    preprocessor: input.preprocessor ?? current.preprocessor,
    postprocessor: input.postprocessor ?? current.postprocessor,
    languages: {
      deploy: input.languages?.deploy ?? current.languages.deploy,
      undeploy: input.languages?.undeploy ?? current.languages.undeploy,
      preprocessor: input.languages?.preprocessor ?? current.languages.preprocessor,
      postprocessor: input.languages?.postprocessor ?? current.languages.postprocessor,
    },
  };
  if (!touched.some((f) => next.languages[f] === 'TYPESCRIPT')) return;
  // Global scripts run for every channel, so every template they could see is in scope.
  const templates = await CodeTemplateService.listTemplates();
  if (!templates.ok) throw templates.error;
  await assertGlobalScriptsTypeCheck(next, touched, templates.value);
}

// ----- Service -----

export class GlobalScriptService {
  /** Get all 4 global scripts. Returns empty strings for missing rows. */
  static async getAll(): Promise<Result<GlobalScriptsData>> {
    return tryCatch(readAll);
  }

  /**
   * Update global scripts (upserts only provided fields). A script that does
   * not compile is refused, and so is a TypeScript script with type errors:
   * global scripts run for every channel, so they are not left to fail each
   * channel's deploy (D-285).
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
      await assertTouchedScriptsTypeCheck(input);

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
            .values({ scriptType: entry.key, script: value ?? '', language: language ?? NEVER_SAVED_LANGUAGE });
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
