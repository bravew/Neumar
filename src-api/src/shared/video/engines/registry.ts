import { createLogger } from '@/shared/utils/logger';

import type { EngineId, VideoEngineAdapter } from './types';

const logger = createLogger('VideoEngineRegistry');

const registry = new Map<EngineId, VideoEngineAdapter>();

export class UnknownVideoEngineError extends Error {
  constructor(public readonly engineId: EngineId) {
    super(`No video engine registered for id "${engineId}"`);
    this.name = 'UnknownVideoEngineError';
  }
}

export class VideoEngineNotInstalledError extends Error {
  constructor(public readonly engineId: EngineId) {
    super(`Video engine "${engineId}" is not installed on this host`);
    this.name = 'VideoEngineNotInstalledError';
  }
}

export function registerVideoEngine(adapter: VideoEngineAdapter): void {
  if (registry.has(adapter.id)) {
    logger.warn(`replacing existing video engine adapter "${adapter.id}"`);
  }
  registry.set(adapter.id, adapter);
}

export function getVideoEngine(id: EngineId): VideoEngineAdapter {
  const adapter = registry.get(id);
  if (!adapter) throw new UnknownVideoEngineError(id);
  return adapter;
}

export function tryGetVideoEngine(
  id: EngineId,
): VideoEngineAdapter | undefined {
  return registry.get(id);
}

export interface VideoEngineSummary {
  id: EngineId;
  name: string;
  upstreamVersion: string;
  installed: boolean;
  availability: Awaited<ReturnType<VideoEngineAdapter['probeAvailability']>>;
  capabilities: VideoEngineAdapter['capabilities'];
}

export async function listVideoEngines(): Promise<VideoEngineSummary[]> {
  const out: VideoEngineSummary[] = [];
  for (const adapter of registry.values()) {
    let availability: Awaited<
      ReturnType<VideoEngineAdapter['probeAvailability']>
    >;
    try {
      availability = await Promise.resolve(adapter.probeAvailability());
    } catch (err) {
      logger.warn(
        `probeAvailability() threw for engine "${adapter.id}": ${(err as Error).message}`,
      );
      availability = {
        installed: false,
        reason: 'not-found',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
    out.push({
      id: adapter.id,
      name: adapter.name,
      upstreamVersion: adapter.upstreamVersion,
      installed: availability.installed,
      availability,
      capabilities: adapter.capabilities,
    });
  }
  return out;
}

/** Test-only. Drop the in-memory registry. */
export function _resetVideoEngineRegistry(): void {
  registry.clear();
}
