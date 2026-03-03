// ===========================================
// Channel Dependency Service
// ===========================================
// Business logic for channel dependency management + DAG validation.
// All methods return Result<T> using tryCatch from stderr-lib.

import { tryCatch, type Result } from 'stderr-lib';
import { eq } from 'drizzle-orm';
import type { SetDependenciesInput } from '@mirthless/core-models';
import { ServiceError } from '../lib/service-error.js';
import { emitEvent, type AuditContext } from '../lib/event-emitter.js';
import { db } from '../lib/db.js';
import { channelDependencies, channels } from '../db/schema/index.js';

// ----- Response Types -----

export interface DependencyInfo {
  readonly channelId: string;
  readonly channelName: string;
}

// ----- Service -----

export class ChannelDependencyService {
  /** Get channels that this channel depends on. */
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

  /** Get channels that depend on this channel. */
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

  /** Set dependencies for a channel (replace all). Validates DAG integrity. */
  static async setDependencies(
    channelId: string,
    input: SetDependenciesInput,
    context?: AuditContext,
  ): Promise<Result<readonly DependencyInfo[]>> {
    return tryCatch(async () => {
      // Verify channel exists
      const [channel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.id, channelId));

      if (!channel) {
        throw new ServiceError('NOT_FOUND', `Channel ${channelId} not found`);
      }

      // Reject self-dependency
      if (input.dependsOnChannelIds.includes(channelId)) {
        throw new ServiceError('INVALID_INPUT', 'A channel cannot depend on itself');
      }

      // Verify all dependency channels exist
      for (const depId of input.dependsOnChannelIds) {
        const [dep] = await db
          .select({ id: channels.id })
          .from(channels)
          .where(eq(channels.id, depId));

        if (!dep) {
          throw new ServiceError('NOT_FOUND', `Dependency channel ${depId} not found`);
        }
      }

      // Validate no cycles (DAG check)
      if (input.dependsOnChannelIds.length > 0) {
        const cycleResult = await ChannelDependencyService.validateDAG(channelId, input.dependsOnChannelIds);
        if (!cycleResult.ok) {
          throw new ServiceError('INVALID_INPUT', cycleResult.error.message);
        }
      }

      // Delete existing dependencies
      await db
        .delete(channelDependencies)
        .where(eq(channelDependencies.channelId, channelId));

      // Insert new dependencies
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

      // Return the new dependency list
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

  /**
   * Validate that adding newDeps to channelId doesn't create a cycle.
   * Uses iterative DFS from each new dependency to check for path back to channelId.
   */
  static async validateDAG(
    channelId: string,
    newDeps: readonly string[],
  ): Promise<Result<void>> {
    return tryCatch(async () => {
      // Build adjacency map from all existing dependencies
      const allDeps = await db
        .select({
          from: channelDependencies.channelId,
          to: channelDependencies.dependsOnChannelId,
        })
        .from(channelDependencies);

      const adjacency = new Map<string, string[]>();

      for (const dep of allDeps) {
        // Skip existing deps for channelId (they're being replaced)
        if (dep.from === channelId) continue;

        let neighbors = adjacency.get(dep.from);
        if (!neighbors) {
          neighbors = [];
          adjacency.set(dep.from, neighbors);
        }
        neighbors.push(dep.to);
      }

      // Add the proposed new edges
      adjacency.set(channelId, [...newDeps]);

      // For each new dependency, DFS to check if there's a path back to channelId
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
