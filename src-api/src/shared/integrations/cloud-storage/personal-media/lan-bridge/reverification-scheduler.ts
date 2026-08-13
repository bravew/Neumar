import type { CloudStorageAdapter } from '@/shared/integrations/cloud-storage/adapter';
import { cloudStorageRegistry } from '@/shared/integrations/cloud-storage/registry';
import { createLogger } from '@/shared/utils/logger';

import { PathMappingsStore } from './path-mappings-store';
import type { ImmichBridgeAsset, PathMapping } from './types';
import {
  DEFAULT_MAX_VERIFY_BYTES,
  verifyBridgeMapping,
  type BridgeVerificationResult,
} from './verifier';

const logger = createLogger('CloudStoragePathMappingReverification');

export const DEFAULT_REVERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_REVERIFY_BATCH_LIMIT = 25;

interface ReverificationStore {
  listDueForReverification(input: {
    maxAgeMs: number;
    limit: number;
    now?: Date;
  }): PathMapping[];
  markVerification(
    id: string,
    verified: boolean,
    options?: { verificationHash?: string; lastError?: string },
  ): void;
}

export interface ReverificationCycleDeps {
  store?: ReverificationStore;
  findAsset?: (mapping: PathMapping) => Promise<ImmichBridgeAsset | null>;
  verify?: (input: {
    asset: ImmichBridgeAsset;
    mapping: Pick<
      PathMapping,
      'id' | 'connectionId' | 'immichPathPrefix' | 'localMountPath'
    >;
  }) => Promise<BridgeVerificationResult>;
  now?: Date;
  maxAgeMs?: number;
  limit?: number;
}

export interface ReverificationCycleSummary {
  checked: number;
  verified: number;
  failed: number;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startPathMappingReverificationScheduler({
  intervalMs = DEFAULT_REVERIFY_INTERVAL_MS,
  initialDelayMs = 60_000,
}: {
  intervalMs?: number;
  initialDelayMs?: number;
} = {}): void {
  if (intervalId) return;

  const run = () => {
    void runPathMappingReverificationCycle().catch((error) => {
      logger.warn('LAN bridge path mapping re-verification failed:', error);
    });
  };

  const initialTimer = setTimeout(run, initialDelayMs);
  initialTimer.unref?.();
  intervalId = setInterval(run, intervalMs);
  intervalId.unref?.();
}

export function stopPathMappingReverificationScheduler(): void {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}

export async function runPathMappingReverificationCycle({
  store = new PathMappingsStore(),
  findAsset = findBridgeVerificationAsset,
  verify = ({ asset, mapping }) => verifyBridgeMapping({ asset, mapping }),
  now = new Date(),
  maxAgeMs = DEFAULT_REVERIFY_INTERVAL_MS,
  limit = DEFAULT_REVERIFY_BATCH_LIMIT,
}: ReverificationCycleDeps = {}): Promise<ReverificationCycleSummary> {
  const mappings = store.listDueForReverification({ maxAgeMs, limit, now });
  const summary: ReverificationCycleSummary = {
    checked: mappings.length,
    verified: 0,
    failed: 0,
  };

  for (const mapping of mappings) {
    try {
      const asset = await findAsset(mapping);
      if (!asset) {
        store.markVerification(mapping.id, false, {
          lastError: 'no_sample_asset',
        });
        summary.failed += 1;
        continue;
      }

      const result = await verify({
        asset,
        mapping,
      });
      if (result.verified) {
        store.markVerification(mapping.id, true, {
          verificationHash: result.verificationHash,
          lastError: undefined,
        });
        summary.verified += 1;
        continue;
      }

      store.markVerification(mapping.id, false, {
        lastError: result.detail
          ? `${result.reason}: ${result.detail}`
          : result.reason,
      });
      summary.failed += 1;
    } catch (error) {
      logger.warn(
        `Failed to re-verify LAN bridge mapping ${mapping.id}:`,
        error,
      );
      store.markVerification(mapping.id, false, {
        lastError: error instanceof Error ? error.message : String(error),
      });
      summary.failed += 1;
    }
  }

  return summary;
}

export async function findBridgeVerificationAsset(
  mapping: PathMapping,
  resolveAdapter: (connectionId: string) => CloudStorageAdapter = (id) =>
    cloudStorageRegistry.resolve(id),
): Promise<ImmichBridgeAsset | null> {
  const adapter = resolveAdapter(mapping.connectionId);
  const page = await adapter.listChildren({ limit: 50 });
  const candidates: ImmichBridgeAsset[] = [];
  for (const file of page.items) {
    const originalPath = file.mediaMetadata?.fileInfo?.originalPath;
    if (!originalPath?.startsWith(mapping.immichPathPrefix)) continue;
    if (file.size <= 0 || file.size > DEFAULT_MAX_VERIFY_BYTES) continue;
    candidates.push({
      id: file.id,
      originalPath,
      fileSizeBytes: file.size,
      checksum: file.mediaMetadata?.fileInfo?.checksum ?? file.etag,
    });
  }
  return (
    candidates.sort((a, b) => a.fileSizeBytes - b.fileSizeBytes)[0] ?? null
  );
}
