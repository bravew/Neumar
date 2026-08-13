import { createHash } from 'node:crypto';

import type { HtmlFrameSeed } from '@/shared/video/types';

// Phase 1 M5 — shared hash function for an html-engine scene's "render
// inputs." Used in two places:
//
//   - html-adapter.ts → as `EngineRenderOutput.meta.inputHash` so an export
//     is auditable + reproducible (PR #233).
//   - pipeline.ts (this slice) → as part of the render-cache key so a
//     scene with the same seed + same template version + same engine
//     version + same resolution + same fps gets a cache hit.
//
// Deterministic: the variables object is canonicalised by sorting object
// keys at every depth before hashing, so `{a:1,b:2}` and `{b:2,a:1}` hash
// the same.
//
// See dev-doc/html-video/06-06/03-slice-B-queue-integration.md.

export interface FrameSeedHashInput {
  seed: HtmlFrameSeed;
  templateSourcePath: string;
  templateVersion: string;
  /** Engine version string used for the render (e.g. `html-playwright/0.1.0`). */
  engineVersion: string;
  resolution: { width: number; height: number };
  fps: number;
  durationSec: number;
  /** Optional injection nonce (only set when called from the adapter). */
  injectionNonce?: string;
}

/** 16-char sha256-prefix of the canonicalised input. */
export function hashHtmlFrameSeed(input: FrameSeedHashInput): string {
  const h = createHash('sha256');
  h.update(input.seed.nodeId);
  h.update('|');
  h.update(input.seed.templateId);
  h.update('|');
  h.update(input.seed.engine);
  h.update('|');
  h.update(canonicalise(input.seed.renderOverride ?? null));
  h.update('|');
  h.update(input.templateSourcePath);
  h.update('|');
  h.update(input.templateVersion);
  h.update('|');
  h.update(input.engineVersion);
  h.update('|');
  h.update(canonicalise(input.seed.variables ?? {}));
  h.update('|');
  h.update(JSON.stringify(input.resolution));
  h.update('|');
  h.update(String(input.fps));
  h.update('|');
  h.update(String(input.durationSec));
  if (input.injectionNonce) {
    h.update('|');
    h.update(input.injectionNonce);
  }
  return h.digest('hex').slice(0, 16);
}

/**
 * Stable JSON: object keys are sorted so different insertion orders hash
 * the same. Arrays preserve order (they are semantically ordered).
 */
function canonicalise(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalise).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(',')}}`;
}
