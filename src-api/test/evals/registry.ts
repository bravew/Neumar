/**
 * Static registry of eval cases. Centralised so unit tests can assert
 * registry completeness and CLI scripts (eval-list / eval-select) can
 * surface metadata without importing every case file.
 */
import assetsCatalogRecall from './cases/assets-catalog-recall.case';
import kimiK3Continuation from './cases/kimi-k3-continuation.case';
import supportBundleRedaction from './cases/support-bundle-redaction.case';
import traceCostRollup from './cases/trace-cost-rollup.case';
import traceCursor from './cases/trace-cursor-stability.case';
import traceRedaction from './cases/trace-redaction.case';
import videoAttributionCoverage from './cases/video-attribution-coverage.case';
import videoAudioHandoff from './cases/video-audio-handoff.case';
import videoAutoCutGate from './cases/video-auto-cut-gate.case';
import videoContentGraphShape from './cases/video-content-graph-shape.case';
import videoGroundedLoop from './cases/video-grounded-loop.case';
import videoSoundtrackDucking from './cases/video-soundtrack-ducking.case';
import videoTimelineEditTools from './cases/video-timeline-edit-tools.case';
import type { EvalCase } from './types';

export const ALL_CASES: EvalCase[] = [
  assetsCatalogRecall,
  kimiK3Continuation,
  supportBundleRedaction,
  traceCostRollup,
  traceCursor,
  traceRedaction,
  videoAudioHandoff,
  videoAttributionCoverage,
  videoAutoCutGate,
  videoContentGraphShape,
  videoGroundedLoop,
  videoSoundtrackDucking,
  videoTimelineEditTools,
];

export function casesByTier(tier: EvalCase['tier']): EvalCase[] {
  return ALL_CASES.filter((c) => c.tier === tier);
}

export function findCase(id: string): EvalCase | undefined {
  return ALL_CASES.find((c) => c.id === id);
}
