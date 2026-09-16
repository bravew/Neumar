import { randomUUID } from 'node:crypto';

import { referenceFingerprint } from '@/shared/video/reference/fingerprint';
import { lintFramework } from '@/shared/video/reference/framework-lint';
import { videoFrameworkSchema } from '@/shared/video/reference/framework-schema';
import { getReferenceReading } from '@/shared/video/reference/reading';
import {
  readReferenceEnvelope,
  writeReferenceEnvelope,
} from '@/shared/video/reference/store';
import { getProject } from '@/shared/video/store';
import type {
  FrameworkSection,
  FrameworkSectionRole,
  ReferenceAnalysis,
  ReferenceBoundaries,
  ReferenceTimelineArtifact,
  ReferenceTimelineSection,
  TranscriptData,
  VideoFramework,
  VideoReference,
} from '@/shared/video/types';

export const FRAMEWORK_MAX_THIN_SHARE = 0.4;
export const FRAMEWORK_CONFIDENCE_FLOOR = 0.4;
export const FRAMEWORK_MAX_LOW_CONFIDENCE_SHARE = 0.3;

export class FrameworkExtractError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'coverage'
      | 'confidence'
      | 'stale'
      | 'missing-reading'
      | 'schema' = 'schema',
  ) {
    super(message);
    this.name = 'FrameworkExtractError';
  }
}

export function assertReadingReadyForFramework(
  timeline: ReferenceTimelineArtifact,
): void {
  const thinMs = timeline.coverage.thinRanges.reduce(
    (sum, range) => sum + Math.max(0, range.endMs - range.startMs),
    0,
  );
  const share = thinMs / Math.max(1, timeline.coverage.totalMs);
  if (share > FRAMEWORK_MAX_THIN_SHARE) {
    throw new FrameworkExtractError(
      `Reading coverage is too thin (${Math.round(share * 100)}% gaps).`,
      'coverage',
    );
  }
  const low = timeline.sections.filter(
    (section) => section.confidence < FRAMEWORK_CONFIDENCE_FLOOR,
  ).length;
  if (
    low / Math.max(1, timeline.sections.length) >
    FRAMEWORK_MAX_LOW_CONFIDENCE_SHARE
  ) {
    throw new FrameworkExtractError(
      'Too many low-confidence timeline sections to extract a framework.',
      'confidence',
    );
  }
}

export function chooseNarrativeSpine(
  sections: ReferenceTimelineSection[],
): ReferenceTimelineSection[] {
  const sorted = [...sections].sort(
    (left, right) => left.startMs - right.startMs,
  );
  const spine: ReferenceTimelineSection[] = [];
  for (const section of sorted) {
    const previous = spine[spine.length - 1];
    if (previous && section.startMs < previous.endMs) continue;
    spine.push(section);
  }
  return spine.length > 0 ? spine : sorted.slice(0, 1);
}

export function normalizeProportions(
  sections: FrameworkSection[],
): FrameworkSection[] {
  const total = sections.reduce(
    (sum, section) => sum + Math.max(0, section.timing.observedMs),
    0,
  );
  if (total <= 0) {
    const even = 1 / Math.max(1, sections.length);
    return sections.map((section) => ({
      ...section,
      timing: { ...section.timing, proportion: even },
    }));
  }
  let remaining = 1;
  return sections.map((section, index) => {
    const proportion =
      index === sections.length - 1
        ? remaining
        : section.timing.observedMs / total;
    remaining -= proportion;
    return {
      ...section,
      timing: { ...section.timing, proportion },
    };
  });
}

export function derivePacing(
  range: { startMs: number; endMs: number },
  boundaries?: ReferenceBoundaries | null,
): FrameworkSection['pacing'] {
  const durationMs = Math.max(1, range.endMs - range.startMs);
  const cuts = (boundaries?.candidates ?? [])
    .map((candidate) => candidate.atMs)
    .filter((atMs) => atMs >= range.startMs && atMs < range.endMs)
    .sort((left, right) => left - right);
  if (cuts.length === 0) {
    return {
      cutsPerMinute: 0,
      shortestHoldMs: durationMs,
      longestHoldMs: durationMs,
    };
  }
  const holds: number[] = [];
  let cursor = range.startMs;
  for (const atMs of cuts) {
    holds.push(Math.max(1, atMs - cursor));
    cursor = atMs;
  }
  holds.push(Math.max(1, range.endMs - cursor));
  return {
    cutsPerMinute: cuts.length / (durationMs / 60_000),
    shortestHoldMs: Math.min(...holds),
    longestHoldMs: Math.max(...holds),
  };
}

export function draftFrameworkFromReading(input: {
  reference: VideoReference;
  analysis: ReferenceAnalysis;
  timeline: ReferenceTimelineArtifact;
  boundaries?: ReferenceBoundaries | null;
}): VideoFramework {
  const spine = chooseNarrativeSpine(input.timeline.sections);
  const sections = normalizeProportions(
    spine.map((section, index) => {
      const observedMs = Math.max(1, section.endMs - section.startMs);
      return {
        id: `fw-${section.id}`,
        role: inferRole(section.phase, index, spine.length),
        purpose: section.effect,
        timing: {
          proportion: 0,
          minMs: Math.round(observedMs * 0.6),
          maxMs: Math.round(observedMs * 1.8),
          observedMs,
        },
        slots: [
          {
            id: `slot-${section.id}`,
            kind: 'a-roll',
            constraints: { minDurationMs: Math.round(observedMs * 0.5) },
            fallback: { kind: 'ask-user' as const },
            required: true,
          },
        ],
        systemIds: section.activeSystems.map((item) => item.systemId),
        pacing: derivePacing(
          { startMs: section.startMs, endMs: section.endMs },
          input.boundaries,
        ),
        confidence: section.confidence,
        derivedFromSectionIds: [section.id],
      };
    }),
  );
  const typicalMs = sections.reduce(
    (sum, section) => sum + section.timing.observedMs,
    0,
  );
  return {
    id: `fw-${randomUUID().slice(0, 8)}`,
    version: 1,
    displayName: `${input.reference.label} framework`,
    category: 'explainer',
    hook: 'cold-open',
    pace: inferPace(sections),
    aspectRatios: ['16:9'],
    totalDuration: {
      typicalMs,
      minMs: Math.round(typicalMs * 0.6),
      maxMs: Math.round(typicalMs * 1.8),
    },
    sections,
    systems: input.analysis.systems
      .map((system) => ({
        id: system.id,
        role: system.role,
        behavior: {
          entry: system.entry,
          active: system.behavior,
          exit: system.exit,
        },
        spans: sections
          .filter((section) => section.systemIds.includes(system.id))
          .map((section) => section.id),
      }))
      .filter((system) => system.spans.length > 0),
    provenance: {
      referenceId: input.reference.id,
      ...(input.reference.sourceUrl
        ? { referenceUrl: input.reference.sourceUrl }
        : {}),
      derivedFromArtifacts: ['analysis', 'timeline'],
      extractedBy: 'video_extract_framework',
      extractedAt: new Date().toISOString(),
    },
    confidence: Math.min(...sections.map((section) => section.confidence), 1),
  };
}

export function postProcessFramework(
  framework: VideoFramework,
  boundaries?: ReferenceBoundaries | null,
): VideoFramework {
  const sections = normalizeProportions(
    framework.sections.map((section) => ({
      ...section,
      pacing: derivePacing(
        {
          startMs: 0,
          endMs: Math.max(1, section.timing.observedMs),
        },
        boundaries
          ? {
              ...boundaries,
              candidates: boundaries.candidates.filter(
                (candidate) => candidate.atMs < section.timing.observedMs,
              ),
            }
          : null,
      ),
    })),
  );
  const typicalMs = Math.max(
    1,
    sections.reduce((sum, section) => sum + section.timing.observedMs, 0),
  );
  return {
    ...framework,
    version: 1,
    sections,
    totalDuration: {
      typicalMs,
      minMs: Math.round(typicalMs * 0.6),
      maxMs: Math.round(typicalMs * 1.8),
    },
    confidence: Math.min(...sections.map((section) => section.confidence), 1),
  };
}

export async function extractReferenceFramework(
  projectId: string,
  referenceId: string,
  draft?: unknown,
): Promise<VideoFramework> {
  const reading = await getReferenceReading(projectId, referenceId);
  if (!reading.analysis || !reading.timeline) {
    throw new FrameworkExtractError(
      'Write analysis and timeline before extracting a framework.',
      'missing-reading',
    );
  }
  if (reading.analysis.stale || reading.timeline.stale) {
    throw new FrameworkExtractError(
      'Reading is stale. Re-write analysis before extracting.',
      'stale',
    );
  }
  assertReadingReadyForFramework(reading.timeline.data);
  const reference = await requireReference(projectId, referenceId);
  const boundaries = (
    await readReferenceEnvelope<ReferenceBoundaries>(
      projectId,
      referenceId,
      'boundaries',
    )
  )?.data;
  const transcript = (
    await readReferenceEnvelope<TranscriptData>(
      projectId,
      referenceId,
      'transcript',
    )
  )?.data;
  const parsed = draft
    ? videoFrameworkSchema.parse(draft)
    : draftFrameworkFromReading({
        reference,
        analysis: reading.analysis.data,
        timeline: reading.timeline.data,
        boundaries,
      });
  const processed = postProcessFramework(parsed, boundaries);
  lintFramework(processed, {
    referenceId,
    contentHash: reference.contentHash,
    transcript,
  });
  await writeReferenceEnvelope(projectId, {
    kind: 'framework',
    referenceId,
    sourceFingerprint: referenceFingerprint({
      analysis: reading.analysis.sourceFingerprint,
      timeline: reading.timeline.sourceFingerprint,
    }),
    derivedFrom: {
      analysis: reading.analysis.sourceFingerprint,
      timeline: reading.timeline.sourceFingerprint,
    },
    generatedAt: new Date().toISOString(),
    producer: 'video_extract_framework',
    data: processed,
  });
  return processed;
}

export async function reviseReferenceFramework(
  projectId: string,
  referenceId: string,
  draft: unknown,
): Promise<VideoFramework> {
  return extractReferenceFramework(projectId, referenceId, draft);
}

export async function getReferenceFramework(
  projectId: string,
  referenceId: string,
): Promise<{ framework: VideoFramework; stale: boolean } | null> {
  const envelope = await readReferenceEnvelope<VideoFramework>(
    projectId,
    referenceId,
    'framework',
  );
  if (!envelope) return null;
  return { framework: envelope.data, stale: Boolean(envelope.stale) };
}

function inferRole(
  phase: string,
  index: number,
  total: number,
): FrameworkSectionRole {
  const text = phase.toLowerCase();
  if (/\bcta|subscribe|follow\b/.test(text)) return 'cta';
  if (/\boutro|end|close\b/.test(text)) return 'outro';
  if (/\bhook|open\b/.test(text) || index === 0) return 'hook';
  if (/\bproof|demo|demonstrate\b/.test(text)) return 'demonstration';
  if (/\bpayoff|reveal\b/.test(text)) return 'payoff';
  if (index === total - 1) return 'outro';
  return 'context';
}

function inferPace(sections: FrameworkSection[]): VideoFramework['pace'] {
  const cuts =
    sections.reduce((sum, section) => sum + section.pacing.cutsPerMinute, 0) /
    Math.max(1, sections.length);
  if (cuts >= 24) return 'extreme';
  if (cuts >= 12) return 'fast';
  if (cuts >= 4) return 'medium';
  return 'slow';
}

async function requireReference(
  projectId: string,
  referenceId: string,
): Promise<VideoReference> {
  const reference = (await getProject(projectId)).videoReferences?.find(
    (item) => item.id === referenceId,
  );
  if (!reference) {
    throw new FrameworkExtractError('Reference not found.', 'missing-reading');
  }
  return reference;
}
