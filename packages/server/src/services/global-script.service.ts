// ===========================================
// Global Script Service
// ===========================================
// Business logic for global scripts (deploy, undeploy, preprocessor, postprocessor).
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq } from 'drizzle-orm';
import type { UpdateGlobalScriptsInput } from '@mirthless/core-models';
import { GLOBAL_SCRIPT_TYPE } from '@mirthless/core-models';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { globalScripts } from '../db/schema/index.js';

// ----- Response Types -----

export interface GlobalScriptsData {
  readonly deploy: string;
  readonly undeploy: string;
  readonly preprocessor: string;
  readonly postprocessor: string;
}

// ----- Service -----

export class GlobalScriptService {
  /** Get all 4 global scripts. Returns empty strings for missing rows. */
  static async getAll(): Promise<Result<GlobalScriptsData>> {
    return tryCatch(async () => {
      const rows = await db
        .select()
        .from(globalScripts);

      const scriptMap = new Map(rows.map((r) => [r.scriptType, r.script]));

      return {
        deploy: scriptMap.get(GLOBAL_SCRIPT_TYPE.DEPLOY) ?? '',
        undeploy: scriptMap.get(GLOBAL_SCRIPT_TYPE.UNDEPLOY) ?? '',
        preprocessor: scriptMap.get(GLOBAL_SCRIPT_TYPE.PREPROCESSOR) ?? '',
        postprocessor: scriptMap.get(GLOBAL_SCRIPT_TYPE.POSTPROCESSOR) ?? '',
      };
    });
  }

  /** Update global scripts (upserts only provided fields). */
  static async update(
    input: UpdateGlobalScriptsInput,
    context?: AuditContext,
  ): Promise<Result<GlobalScriptsData>> {
    return tryCatch(async () => {
      const entries: ReadonlyArray<{ key: string; field: keyof UpdateGlobalScriptsInput }> = [
        { key: GLOBAL_SCRIPT_TYPE.DEPLOY, field: 'deploy' },
        { key: GLOBAL_SCRIPT_TYPE.UNDEPLOY, field: 'undeploy' },
        { key: GLOBAL_SCRIPT_TYPE.PREPROCESSOR, field: 'preprocessor' },
        { key: GLOBAL_SCRIPT_TYPE.POSTPROCESSOR, field: 'postprocessor' },
      ];

      for (const entry of entries) {
        const value = input[entry.field];
        if (value === undefined) continue;

        const [existing] = await db
          .select({ scriptType: globalScripts.scriptType })
          .from(globalScripts)
          .where(eq(globalScripts.scriptType, entry.key));

        if (existing) {
          await db
            .update(globalScripts)
            .set({ script: value, updatedAt: new Date() })
            .where(eq(globalScripts.scriptType, entry.key));
        } else {
          await db
            .insert(globalScripts)
            .values({ scriptType: entry.key, script: value });
        }
      }

      // Fetch all to return the current state
      const rows = await db
        .select()
        .from(globalScripts);

      const scriptMap = new Map(rows.map((r) => [r.scriptType, r.script]));

      emitEvent({
        level: 'INFO', name: 'GLOBAL_SCRIPT_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId: null,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { updatedScripts: Object.keys(input).filter((k) => input[k as keyof UpdateGlobalScriptsInput] !== undefined) },
      });

      return {
        deploy: scriptMap.get(GLOBAL_SCRIPT_TYPE.DEPLOY) ?? '',
        undeploy: scriptMap.get(GLOBAL_SCRIPT_TYPE.UNDEPLOY) ?? '',
        preprocessor: scriptMap.get(GLOBAL_SCRIPT_TYPE.PREPROCESSOR) ?? '',
        postprocessor: scriptMap.get(GLOBAL_SCRIPT_TYPE.POSTPROCESSOR) ?? '',
      };
    });
  }
}
