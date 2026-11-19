import { tryCatch, type Result } from 'stderr-lib';
import { eq } from 'drizzle-orm';
import type { SetDependenciesInput } from '@galvanigraph/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { channelDependencies, channels } from '../db/schema/index.js';

export interface DependencyInfo {
  readonly channelId: string;
  readonly channelName: string;
}

export interface DependencyEdge {
  readonly channelId: string;
  readonly dependsOnChannelId: string;
}

/**
 * Ties keep the input order. Ids left by a cycle (validateDAG prevents one, but
 * the table can be edited directly) are appended, so none is dropped.
 */
export function orderByDependencies(
  ids: readonly string[],
  edges: readonly DependencyEdge[],
): readonly string[] {
  const included = new Set(ids);
  const pending = new Map<string, number>(ids.map((id) => [id, 0]));
  const dependents = new Map<string, string[]>();
  for (const { channelId, dependsOnChannelId } of edges) {
    if (!included.has(channelId) || !included.has(dependsOnChannelId)) continue;
    pending.set(channelId, (pending.get(channelId) ?? 0) + 1);
    dependents.set(dependsOnChannelId, [...(dependents.get(dependsOnChannelId) ?? []), channelId]);
  }

  const ordered: string[] = [];
  const placed = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of ids) {
      if (placed.has(id) || pending.get(id) !== 0) continue;
      ordered.push(id);
      placed.add(id);
      progressed = true;
      for (const dependent of dependents.get(id) ?? []) {
        pending.set(dependent, (pending.get(dependent) ?? 0) - 1);
      }
    }
  }
  return [...ordered, ...ids.filter((id) => !placed.has(id))];
}

export class ChannelDependencyService {
  static async listAll(): Promise<Result<readonly DependencyEdge[]>> {
    return tryCatch(async () => db
      .select({
        channelId: channelDependencies.channelId,
        dependsOnChannelId: channelDependencies.dependsOnChannelId,
      })
      .from(channelDependencies));
  }

  static async getDependencies(channelId: string): Promise<Result<readonly DependencyInfo[]>> {
    return tryCatch(async () => {
      const [channel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.id, channelId));

      if (!channel) {
        throw new ServiceError('NOT_FOUND', `Channel ${channelId} not found`);
      }

      const deps = await db
        .select({
          channelId: channels.id,
          channelName: channels.name,
        })
        .from(channelDependencies)
        .innerJoin(channels, eq(channelDependencies.dependsOnChannelId, channels.id))
        .where(eq(channelDependencies.channelId, channelId));

      return deps;
    });
  }

  static async getDependents(channelId: string): Promise<Result<readonly DependencyInfo[]>> {
    return tryCatch(async () => {
      const [channel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.id, channelId));

      if (!channel) {
        throw new ServiceError('NOT_FOUND', `Channel ${channelId} not found`);
      }

      const deps = await db
        .select({
          channelId: channels.id,
          channelName: channels.name,
        })
        .from(channelDependencies)
        .innerJoin(channels, eq(channelDependencies.channelId, channels.id))
        .where(eq(channelDependencies.dependsOnChannelId, channelId));

      return deps;
    });
  }

  static async setDependencies(
    channelId: string,
    input: SetDependenciesInput,
    context?: AuditContext,
  ): Promise<Result<readonly DependencyInfo[]>> {
    return tryCatch(async () => {
      const [channel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.id, channelId));

      if (!channel) {
        throw new ServiceError('NOT_FOUND', `Channel ${channelId} not found`);
      }

      if (input.dependsOnChannelIds.includes(channelId)) {
        throw new ServiceError('INVALID_INPUT', 'A channel cannot depend on itself');
      }

      for (const depId of input.dependsOnChannelIds) {
        const [dep] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(eq(channels.id, depId));

        if (!dep) {
          throw new ServiceError('NOT_FOUND', `Dependency channel ${depId} not found`);
        }
      }

      if (input.dependsOnChannelIds.length > 0) {
        const cycleResult = await ChannelDependencyService.validateDAG(channelId, input.dependsOnChannelIds);
        if (!cycleResult.ok) {
          throw new ServiceError('INVALID_INPUT', cycleResult.error.message);
        }
      }

      await db
        .delete(channelDependencies)
        .where(eq(channelDependencies.channelId, channelId));

      if (input.dependsOnChannelIds.length > 0) {
        await db
          .insert(channelDependencies)
          .values(input.dependsOnChannelIds.map((depId) => ({
            channelId,
            dependsOnChannelId: depId,
          })));
      }

      emitEvent({
        level: 'INFO', name: 'CHANNEL_DEPENDENCY_UPDATED', outcome: 'SUCCESS',
        userId: context?.userId ?? null, channelId,
        serverId: null, ipAddress: context?.ipAddress ?? null,
        attributes: { action: 'setDependencies', dependsOnChannelIds: input.dependsOnChannelIds },
      });

      const deps = await db
        .select({
          channelId: channels.id,
          channelName: channels.name,
        })
        .from(channelDependencies)
        .innerJoin(channels, eq(channelDependencies.dependsOnChannelId, channels.id))
        .where(eq(channelDependencies.channelId, channelId));

      return deps;
    });
  }

  static async validateDAG(
    channelId: string,
    newDeps: readonly string[],
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      const allDeps = await db
        .select({
          from: channelDependencies.channelId,
          to: channelDependencies.dependsOnChannelId,
        })
        .from(channelDependencies);

      const adjacency = new Map<string, string[]>();

      for (const dep of allDeps) {
        // channelId's existing deps are being replaced.
        if (dep.from === channelId) continue;

        let neighbors = adjacency.get(dep.from);
        if (!neighbors) {
          neighbors = [];
          adjacency.set(dep.from, neighbors);
        }
        neighbors.push(dep.to);
      }

      adjacency.set(channelId, [...newDeps]);

      for (const depId of newDeps) {
        const visited = new Set<string>();
        const stack: string[] = [depId];

        while (stack.length > 0) {
          const current = stack.pop()!;

          if (current === channelId) {
            throw new ServiceError(
              'INVALID_INPUT',
              `Circular dependency detected: adding dependency on ${depId} creates a cycle`,
            );
          }

          if (visited.has(current)) continue;
          visited.add(current);

          const neighbors = adjacency.get(current);
          if (neighbors) {
            for (const neighbor of neighbors) {
              if (!visited.has(neighbor)) {
                stack.push(neighbor);
              }
            }
          }
        }
      }
    });
  }
}
