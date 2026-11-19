// ===========================================
// Deployment Record Service
// ===========================================
// What a deploy deployed: the channel configuration and the code templates and
// global scripts compiled into it, read from one snapshot of the database, and
// recorded so that a restart brings back exactly that (#225, D-323).

import { tryCatch, type Result } from 'stderr-lib';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, type DbReader, type DbTransaction } from '../lib/db.js';
import { channelDeploymentAdoptions, channelDeployments, channels, type ChannelDeploymentRow } from '../db/schema/index.js';
import { ServiceError } from '../lib/service-error.js';
import { ChannelService, type ChannelDetail } from './channel.service.js';
import { CodeTemplateService, type TemplateDetail } from './code-template.service.js';
import { GlobalScriptService, type GlobalScriptsData } from './global-script.service.js';

// ----- Types -----

/** A code template as a deploy compiles it in. */
export interface DeployedTemplate {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly language: string;
  readonly code: string;
  readonly type: string;
  readonly contexts: ReadonlyArray<string>;
}

/** Everything a deploy compiles and runs that a save can change. */
export interface DeploymentBundle {
  readonly channel: ChannelDetail;
  readonly templates: ReadonlyArray<DeployedTemplate>;
  readonly globalScripts: GlobalScriptsData;
}

/** A channel's recorded deployment, as the startup redeploy reads it. */
export type RecordedDeployment =
  | { readonly kind: 'deployed'; readonly bundle: DeploymentBundle }
  | { readonly kind: 'undeployed' }
  | { readonly kind: 'unreadable'; readonly reason: string };

/**
 * The layout of a stored bundle. Raise it when the stored shape changes in a
 * way an older row cannot be read as, and teach `parseRow` the old one (or
 * migrate the rows): a row in a format this version does not know is refused,
 * never guessed at.
 */
export const DEPLOYMENT_FORMAT = 1;

/**
 * Every field a stored channel must have. Typed against ChannelDetail, so a
 * field added there fails the build here until someone decides what an older
 * row without it means (a migration that fills it in the stored rows, or a new
 * format). A row missing one is refused rather than deployed with it undefined.
 */
const CHANNEL_FIELDS = {
  id: true, name: true, description: true, enabled: true, revision: true,
  inboundDataType: true, outboundDataType: true, sourceConnectorType: true,
  createdAt: true, updatedAt: true, responseMode: true, responseConnectorName: true,
  initialState: true, messageStorageMode: true, encryptData: true,
  removeContentOnCompletion: true, removeAttachmentsOnCompletion: true,
  pruningEnabled: true, pruningMaxAgeDays: true, pruningArchiveEnabled: true,
  scriptTimeoutSeconds: true, sourceConnectorProperties: true, scripts: true,
  destinations: true, metadataColumns: true, tags: true, filters: true, transformers: true,
} as const satisfies Record<keyof ChannelDetail, true>;

const GLOBAL_SCRIPT_FIELDS = {
  deploy: true, undeploy: true, preprocessor: true, postprocessor: true, languages: true,
} as const satisfies Record<keyof GlobalScriptsData, true>;

// ----- Helpers -----

function toDeployedTemplate(t: TemplateDetail): DeployedTemplate {
  return { id: t.id, name: t.name, revision: t.revision, language: t.language, code: t.code, type: t.type, contexts: t.contexts };
}

function missingFields(value: unknown, fields: Readonly<Record<string, true>>): string[] {
  if (typeof value !== 'object' || value === null) return Object.keys(fields);
  return Object.keys(fields).filter((f) => !(f in value));
}

/** A stored row as a bundle, or why it cannot be deployed. */
function parseRow(row: ChannelDeploymentRow): RecordedDeployment {
  if (row.format !== DEPLOYMENT_FORMAT) {
    return { kind: 'unreadable', reason: `its deployment record is in format ${String(row.format)}, which this version does not read` };
  }
  const missing = [
    ...missingFields(row.channel, CHANNEL_FIELDS).map((f) => `channel.${f}`),
    ...missingFields(row.globalScripts, GLOBAL_SCRIPT_FIELDS).map((f) => `globalScripts.${f}`),
  ];
  if (missing.length > 0 || !Array.isArray(row.codeTemplates)) {
    return { kind: 'unreadable', reason: `its deployment record is missing ${missing.length > 0 ? missing.join(', ') : 'codeTemplates'}` };
  }
  const stored = row.channel as unknown as ChannelDetail;
  // JSON keeps times as text; ChannelDetail holds Dates.
  const channel: ChannelDetail = { ...stored, createdAt: new Date(stored.createdAt), updatedAt: new Date(stored.updatedAt) };
  return {
    kind: 'deployed',
    bundle: { channel, templates: row.codeTemplates as unknown as DeployedTemplate[], globalScripts: row.globalScripts as unknown as GlobalScriptsData },
  };
}

function unwrapOrThrow<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

/** The bundle as saved now, read through `reader`. */
async function readSaved(channelId: string, reader: DbReader): Promise<DeploymentBundle> {
  const channel = unwrapOrThrow(await ChannelService.getById(channelId, reader));
  const templates = unwrapOrThrow(await CodeTemplateService.listTemplatesForChannel(channelId, reader));
  const globalScripts = unwrapOrThrow(await GlobalScriptService.getAll(reader));
  return { channel, templates: templates.map(toDeployedTemplate), globalScripts };
}

// ----- Service -----

export class DeploymentRecordService {
  /**
   * The channel, its code templates and the global scripts as saved now, read
   * in one REPEATABLE READ transaction: a save landing mid-read cannot give a
   * mix of before and after that was never saved together.
   */
  static async loadSaved(channelId: string): Promise<Result<DeploymentBundle>> {
    return tryCatch(() => db.transaction(
      (tx) => readSaved(channelId, tx),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    ));
  }

  /**
   * Record `bundle` as the channel's deployment, replacing the previous one,
   * and stamp the channel's last deploy time, in one transaction.
   */
  static async record(bundle: DeploymentBundle, deployedBy: string | null): Promise<Result<void>> {
    return tryCatch(() => db.transaction(async (tx) => {
      await writeRecord(tx, bundle, deployedBy);
    }));
  }

  /**
   * Mark the channel undeployed (so a restart leaves it undeployed), or clear
   * the mark when the undeploy it was set for failed. No-op without a record.
   */
  static async markUndeployed(channelId: string, undeployed: boolean): Promise<Result<void>> {
    return tryCatch(async () => {
      await db.update(channelDeployments)
        .set({ undeployedAt: undeployed ? new Date() : null })
        .where(eq(channelDeployments.channelId, channelId));
    });
  }

  /** The recorded deployments of `channelIds`; a channel with no record is absent. */
  static async listRecorded(channelIds: readonly string[]): Promise<Result<ReadonlyMap<string, RecordedDeployment>>> {
    return tryCatch(async () => {
      if (channelIds.length === 0) return new Map<string, RecordedDeployment>();
      const rows = await db.select().from(channelDeployments).where(inArray(channelDeployments.channelId, [...channelIds]));
      return new Map(rows.map((row) => [row.channelId, row.undeployedAt === null ? parseRow(row) : { kind: 'undeployed' as const }]));
    });
  }

  /** Channels still waiting for their one-time adoption after the upgrade (D-323). */
  static async listPendingAdoptions(): Promise<Result<ReadonlySet<string>>> {
    return tryCatch(async () => {
      const rows = await db.select({ channelId: channelDeploymentAdoptions.channelId }).from(channelDeploymentAdoptions);
      return new Set(rows.map((r) => r.channelId));
    });
  }

  /** Take channels off the adoption list without adopting them (no longer enabled, or deleted). */
  static async dropAdoptions(channelIds: readonly string[]): Promise<Result<void>> {
    return tryCatch(async () => {
      if (channelIds.length === 0) return;
      await db.delete(channelDeploymentAdoptions).where(inArray(channelDeploymentAdoptions.channelId, [...channelIds]));
    });
  }

  /**
   * Adopt the channel's saved configuration as its deployment, once: read it,
   * record it and drop its adoption row in one transaction, unless a deploy
   * has recorded one since (then only the adoption row goes).
   */
  static async adoptSaved(channelId: string): Promise<Result<DeploymentBundle | null>> {
    return tryCatch(() => db.transaction(async (tx) => {
      await tx.delete(channelDeploymentAdoptions).where(eq(channelDeploymentAdoptions.channelId, channelId));
      const [existing] = await tx.select({ channelId: channelDeployments.channelId }).from(channelDeployments)
        .where(eq(channelDeployments.channelId, channelId));
      if (existing) return null;
      const bundle = await readSaved(channelId, tx);
      await writeRecord(tx, bundle, null);
      return bundle;
    }, { isolationLevel: 'repeatable read' }));
  }
}

async function writeRecord(tx: DbTransaction, bundle: DeploymentBundle, deployedBy: string | null): Promise<void> {
  const deployedAt = new Date();
  const values = {
    channelRevision: bundle.channel.revision,
    format: DEPLOYMENT_FORMAT,
    channel: bundle.channel as unknown as Record<string, unknown>,
    codeTemplates: bundle.templates as unknown as ReadonlyArray<Record<string, unknown>>,
    globalScripts: bundle.globalScripts as unknown as Record<string, unknown>,
    deployedBy,
    deployedAt,
    undeployedAt: null,
  };
  await tx.insert(channelDeployments)
    .values({ channelId: bundle.channel.id, ...values })
    .onConflictDoUpdate({ target: channelDeployments.channelId, set: values });
  const updated = await tx.update(channels).set({ lastDeployedAt: deployedAt })
    .where(and(eq(channels.id, bundle.channel.id), isNull(channels.deletedAt)))
    .returning({ id: channels.id });
  if (updated.length === 0) throw new ServiceError('NOT_FOUND', `Channel not found: ${bundle.channel.id}`);
}
