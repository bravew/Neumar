import type { BridgeResolution } from './types';

export interface PathMappingVerificationWriter {
  markVerification?: (
    id: string,
    verified: boolean,
    options?: { verificationHash?: string; lastError?: string },
  ) => void;
}

interface BridgeFailureCounterOptions {
  windowSize?: number;
  failureRatioThreshold?: number;
}

interface BridgeResolutionRecord {
  mappingId: string;
  success: boolean;
  reason?: string;
  store: PathMappingVerificationWriter;
}

export class LanBridgeFailureCounter {
  private readonly windowSize: number;
  private readonly failureRatioThreshold: number;
  private readonly windows = new Map<string, boolean[]>();

  constructor(options: BridgeFailureCounterOptions = {}) {
    this.windowSize = options.windowSize ?? 100;
    this.failureRatioThreshold = options.failureRatioThreshold ?? 0.5;
  }

  record(input: BridgeResolutionRecord): void {
    const window = this.windows.get(input.mappingId) ?? [];
    window.push(input.success);
    if (window.length > this.windowSize) {
      window.shift();
    }
    this.windows.set(input.mappingId, window);

    if (window.length < this.windowSize) return;

    const failureCount = window.filter((success) => !success).length;
    if (failureCount / window.length <= this.failureRatioThreshold) return;

    input.store.markVerification?.(input.mappingId, false, {
      lastError: input.reason ?? 'persistent_lan_bridge_failures',
    });
    this.windows.delete(input.mappingId);
  }
}

export const lanBridgeFailureCounter = new LanBridgeFailureCounter();

export function recordBridgeResolution(
  resolution: BridgeResolution,
  store: PathMappingVerificationWriter,
): void {
  if (resolution.kind === 'local') {
    lanBridgeFailureCounter.record({
      mappingId: resolution.mappingId,
      success: true,
      store,
    });
    return;
  }

  if (!resolution.mappingId) return;
  lanBridgeFailureCounter.record({
    mappingId: resolution.mappingId,
    success: false,
    reason: resolution.reason,
    store,
  });
}
