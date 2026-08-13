import type { InstalledPlugin } from '@/shared/db/plugins';
import type { PluginScope } from '@/shared/plugins';

import type { TrustTier } from './capability-registry';
import { digestStableJson } from './snapshot';

export interface PluginTrustState {
  trustTier: TrustTier;
  manifestDigest: string;
  lastReviewedDigest: string | null;
  restricted: boolean;
  reasons: string[];
}

export function deriveTrustTierFromScope(scope: PluginScope): TrustTier {
  switch (scope) {
    case 'bundled':
      return 'bundled';
    case 'project':
    case 'user':
      return 'local';
    case 'marketplace':
      return 'marketplace';
    case 'legacy':
      return 'local';
    default: {
      const exhaustive: never = scope;
      return exhaustive;
    }
  }
}

export function computeManifestDigest(manifest: unknown): string {
  return digestStableJson(manifest);
}

export function getPluginTrustState(input: {
  trustTier: TrustTier;
  manifest: unknown;
  lastReviewedDigest?: string | null;
  signatureOk?: boolean | null;
}): PluginTrustState {
  const manifestDigest = computeManifestDigest(input.manifest);
  const reasons: string[] = [];
  const trustedTier =
    input.trustTier === 'bundled' || input.trustTier === 'saved';
  const reviewed = input.lastReviewedDigest === manifestDigest;

  if (input.signatureOk === false) {
    reasons.push('Plugin signature is invalid');
  }
  if (!trustedTier && !reviewed) {
    reasons.push('Plugin manifest digest has not been reviewed');
  }

  return {
    trustTier: input.trustTier,
    manifestDigest,
    lastReviewedDigest: input.lastReviewedDigest ?? null,
    restricted: reasons.length > 0,
    reasons,
  };
}

export function trustStateFromInstalledPlugin(
  plugin: InstalledPlugin,
): PluginTrustState {
  return getPluginTrustState({
    trustTier: plugin.trustTier ?? 'local',
    manifest: plugin.manifest,
    lastReviewedDigest: plugin.lastReviewedDigest,
    signatureOk: plugin.signatureOk,
  });
}
