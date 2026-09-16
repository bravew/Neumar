import { analyzeProjectAssets } from '@/shared/video/asset-aspect';
import type {
  AspectRatio,
  FrameworkSection,
  FrameworkSlot,
  MediaItem,
  TranscriptData,
  VideoFramework,
  VideoProject,
} from '@/shared/video/types';

export interface SlotCandidate {
  assetId: string;
  score: number;
  reason: string;
  trimMs?: [number, number];
}

export interface BoundSlot {
  sectionId: string;
  slot: FrameworkSlot;
  chosen: SlotCandidate | null;
  alternatives: SlotCandidate[];
}

export interface BindFrameworkInput {
  transcripts?: Record<string, TranscriptData>;
  frameHits?: Array<{ assetId: string; score: number }>;
  targetAspect?: AspectRatio;
}

export function bindFrameworkSlots(
  project: VideoProject,
  framework: VideoFramework,
  input: BindFrameworkInput = {},
): BoundSlot[] {
  const assets = project.assets.filter(
    (asset) => !asset.path.startsWith('references/'),
  );
  const aspect = analyzeProjectAssets(
    project,
    input.targetAspect ?? framework.aspectRatios[0] ?? '16:9',
  );
  const momentScore = momentScores(project);
  const frameScore = new Map(
    (input.frameHits ?? []).map((hit) => [hit.assetId, hit.score]),
  );
  return framework.sections.flatMap((section) =>
    section.slots.map((slot) => {
      const ranked = assets
        .map((asset) =>
          scoreCandidate(asset, section, slot, {
            transcripts: input.transcripts,
            aspectLogoIds: new Set(aspect.logoAssetIds ?? []),
            momentScore,
            frameScore,
          }),
        )
        .filter((candidate): candidate is SlotCandidate => candidate !== null)
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.assetId.localeCompare(right.assetId),
        );
      return {
        sectionId: section.id,
        slot,
        chosen: ranked[0] ?? null,
        alternatives: ranked.slice(1, 4),
      };
    }),
  );
}

function scoreCandidate(
  asset: MediaItem,
  section: FrameworkSection,
  slot: FrameworkSlot,
  context: {
    transcripts?: Record<string, TranscriptData>;
    aspectLogoIds: Set<string>;
    momentScore: Map<string, number>;
    frameScore: Map<string, number>;
  },
): SlotCandidate | null {
  const wanted = wantedAssetKind(slot.kind);
  if (asset.kind !== wanted) return null;
  const neededMs = Math.max(
    slot.constraints.minDurationMs ?? 0,
    section.timing.minMs,
  );
  if (asset.metadata.durationMs < neededMs) return null;
  if (
    slot.constraints.aspect?.length &&
    !aspectMatches(asset, slot.constraints.aspect)
  ) {
    return null;
  }
  if (slot.constraints.requiresMotion && asset.kind !== 'video') return null;
  const transcript = context.transcripts?.[asset.id];
  if (slot.constraints.requiresSpeech) {
    if (!transcript || transcript.words.length === 0) return null;
  }
  let score = 1;
  const reasons: string[] = [`${asset.kind} matches ${slot.kind}`];
  const durationDelta = Math.abs(
    asset.metadata.durationMs - section.timing.observedMs,
  );
  score += Math.max(
    0,
    1 - durationDelta / Math.max(1, section.timing.observedMs),
  );
  if (slot.constraints.subject) {
    const haystack =
      `${asset.id} ${asset.path} ${asset.provenance?.prompt ?? ''}`.toLowerCase();
    if (haystack.includes(slot.constraints.subject.toLowerCase())) {
      score += 0.8;
      reasons.push(`subject ${slot.constraints.subject}`);
    }
  }
  if (context.aspectLogoIds.has(asset.id) && !/logo/i.test(slot.kind)) {
    score -= 0.6;
    reasons.push('logo-like asset demoted');
  }
  const moment = context.momentScore.get(asset.id) ?? 0;
  if (moment > 0) {
    score += moment;
    reasons.push('ranked analysis moment');
  }
  const frame = context.frameScore.get(asset.id) ?? 0;
  if (frame > 0) {
    score += frame;
    reasons.push('frame search hit');
  }
  if (transcript && slot.constraints.requiresSpeech) {
    score += 0.4;
    reasons.push('speech present');
  }
  return {
    assetId: asset.id,
    score: Number(score.toFixed(3)),
    reason: reasons.join('; '),
  };
}

export function wantedAssetKind(slotKind: string): MediaItem['kind'] {
  const kind = slotKind.toLowerCase();
  if (/(audio|narration|voice|music|sfx)/.test(kind)) return 'audio';
  if (/(image|still|title|card)/.test(kind)) return 'image';
  return 'video';
}

function aspectMatches(asset: MediaItem, allowed: AspectRatio[]): boolean {
  const width = asset.metadata.width;
  const height = asset.metadata.height;
  if (!width || !height) return true;
  const ratio = width / height;
  return allowed.some((item) => Math.abs(ratio - aspectValue(item)) < 0.2);
}

function aspectValue(aspect: AspectRatio): number {
  if (aspect === '9:16') return 9 / 16;
  if (aspect === '1:1') return 1;
  if (aspect === '4:5') return 4 / 5;
  return 16 / 9;
}

function momentScores(project: VideoProject): Map<string, number> {
  const sourceToAsset = new Map(
    (project.sources ?? []).map((source) => [source.id, source.mediaItemId]),
  );
  const scores = new Map<string, number>();
  for (const analysis of project.sourceAnalyses ?? []) {
    const assetId = sourceToAsset.get(analysis.sourceId);
    if (!assetId) continue;
    const cut = Math.max(
      0,
      ...analysis.cutCandidates.map((candidate) => candidate.confidence),
    );
    scores.set(assetId, Math.max(scores.get(assetId) ?? 0, cut));
  }
  return scores;
}
