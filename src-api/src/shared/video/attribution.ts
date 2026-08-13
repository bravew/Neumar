import type { VideoProject } from '@/shared/video/types';

// Phase 7 governance — attribution aggregation. Required credits are surfaced in
// the exported MP4 metadata + disclosure sidecar, and (where the source demands
// it) on-screen via the storyboard caption-credit requirement enforced by
// `assertCreditsCover` in render-plan.ts. Single source of truth for "what must
// be credited" so the metadata path and the on-screen check never diverge.

export interface AttributionCredit {
  /** Display name of the source (asset/provider), for humans. */
  source: string;
  /** The credit string that must appear (in metadata and/or on-screen). */
  attribution: string;
  license?: string;
  /** True when the source's license makes the credit mandatory. */
  required: boolean;
}

/** Lowercase + collapse whitespace — credit comparison is presentation-agnostic. */
export function normalizeCredit(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Collect the de-duplicated attribution credits for a project from its assets'
 * provenance. An asset contributes a credit when it carries an `attribution`
 * string; `required` reflects the source license (`attributionRequired`).
 */
export function collectProjectAttributions(
  project: VideoProject,
): AttributionCredit[] {
  const byKey = new Map<string, AttributionCredit>();
  for (const asset of project.assets) {
    const attribution = asset.provenance?.attribution?.trim();
    if (!attribution) continue;
    const key = normalizeCredit(attribution);
    const existing = byKey.get(key);
    const required = Boolean(asset.provenance?.attributionRequired);
    if (existing) {
      // Keep the credit required if any contributing asset requires it.
      existing.required ||= required;
      continue;
    }
    byKey.set(key, {
      source: asset.provenance?.sourceDisplayName ?? asset.id,
      attribution,
      ...(asset.provenance?.license
        ? { license: asset.provenance.license }
        : {}),
      required,
    });
  }
  return [...byKey.values()];
}

/** Only the credits whose license makes them mandatory. */
export function requiredAttributions(
  project: VideoProject,
): AttributionCredit[] {
  return collectProjectAttributions(project).filter((c) => c.required);
}

/** A single-line "Credits: A · B · C" string, or undefined when there are none. */
export function buildCreditLine(
  credits: AttributionCredit[],
): string | undefined {
  const parts = credits.map((c) => c.attribution.trim()).filter(Boolean);
  return parts.length > 0 ? `Credits: ${parts.join(' · ')}` : undefined;
}
