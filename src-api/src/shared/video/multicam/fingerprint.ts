import { createHash } from 'node:crypto';

import type { MulticamManifest } from './manifest';

/**
 * A fingerprint of everything a derived artifact depends on.
 *
 * Every artifact in the chain (sync map → activity map → shot plan) stores one,
 * so a stale artifact is detectable rather than silently reused. It covers the
 * manifest *and* the source identities, because either changing invalidates the
 * work: swapping an asset behind the same camera id changes the answer as much
 * as re-pointing the camera does.
 */
export function multicamFingerprint(input: {
  manifest: MulticamManifest;
  /** Per-asset identity — content hash where known, else path plus size. */
  sourceIdentities: Record<string, string>;
  /** Upstream artifact fingerprints this one is derived from. */
  parents?: string[];
}): string {
  const canonical = JSON.stringify({
    manifest: canonicalManifest(input.manifest),
    sources: Object.entries(input.sourceIdentities).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
    parents: [...(input.parents ?? [])].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * The manifest fields a derived artifact actually depends on. The label is not
 * one of them: renaming a camera group must not invalidate an hour of analysis.
 */
function canonicalManifest(manifest: MulticamManifest) {
  return {
    id: manifest.id,
    referenceCameraId: manifest.referenceCameraId,
    syncMode: manifest.syncMode,
    policy: manifest.policy,
    participants: manifest.participants
      .map((participant) => participant.id)
      .sort(),
    cameras: [...manifest.cameras]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((camera) => ({
        id: camera.id,
        type: camera.type,
        assetId: camera.assetId,
        participantId: camera.participantId ?? null,
        isolatedAudioAssetId: camera.isolatedAudioAssetId ?? null,
        offsetMs: camera.offsetMs ?? 0,
      })),
  };
}

export function fingerprintMatches(
  artifactFingerprint: string | undefined,
  expected: string,
): boolean {
  return artifactFingerprint === expected;
}
