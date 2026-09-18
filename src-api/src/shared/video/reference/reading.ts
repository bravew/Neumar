import path from 'node:path';

import { ZodError } from 'zod';

import type { PackedTranscriptPayload } from '@/shared/video/analysis/pack-transcript';
import { referenceFingerprint } from '@/shared/video/reference/fingerprint';
import {
  renderReferenceAnalysisMarkdown,
  renderReferenceTimelineMarkdown,
} from '@/shared/video/reference/markdown';
import {
  referenceAnalysisSchema,
  referenceTimelineArtifactSchema,
} from '@/shared/video/reference/reading-schema';
import {
  computeReferenceCoverage,
  ReferenceReadingValidationError,
  validateReferenceAnalysis,
  validateReferenceTimeline,
} from '@/shared/video/reference/reading-validate';
import {
  readReferenceEnvelope,
  writeReferenceEnvelope,
  writeReferenceText,
} from '@/shared/video/reference/store';
import { getProject, getVideoReferenceDir } from '@/shared/video/store';
import type {
  EvidenceItem,
  ReferenceAnalysis,
  ReferenceArtifactEnvelope,
  ReferenceArtifactKind,
  ReferenceCoverage,
  ReferenceProbe,
  ReferenceTimelineArtifact,
  VideoReference,
} from '@/shared/video/types';

export interface ReferenceReading {
  analysis: ReferenceArtifactEnvelope<ReferenceAnalysis> | null;
  timeline: ReferenceArtifactEnvelope<ReferenceTimelineArtifact> | null;
  evidence: EvidenceItem[];
  coverage: ReferenceCoverage | null;
}

export async function writeReferenceAnalysis(
  projectId: string,
  referenceId: string,
  raw: unknown,
): Promise<ReferenceArtifactEnvelope<ReferenceAnalysis>> {
  const analysis = parseAnalysis(raw);
  const context = await loadReadingContext(projectId, referenceId);
  validateReferenceAnalysis(analysis, {
    durationMs: context.durationMs,
    evidence: context.evidence,
  });
  const sourceFingerprint = analysisFingerprint({
    transcriptFp: context.transcriptFp,
    packedFp: context.packedFp,
    boundariesFp: context.boundariesFp,
    evidenceIds: analysis.systems.flatMap((system) => system.evidenceIds),
    promptVersion: analysis.promptVersion,
  });
  const envelope: ReferenceArtifactEnvelope<ReferenceAnalysis> = {
    kind: 'analysis',
    referenceId,
    sourceFingerprint,
    derivedFrom: {
      ...(context.transcriptFp ? { transcript: context.transcriptFp } : {}),
      ...(context.packedFp ? { 'packed-transcript': context.packedFp } : {}),
      ...(context.boundariesFp ? { boundaries: context.boundariesFp } : {}),
    },
    generatedAt: new Date().toISOString(),
    producer: 'video_reference_write_analysis',
    data: analysis,
  };
  await writeReferenceEnvelope(projectId, envelope);
  await writeReferenceText(
    projectId,
    path.join(getVideoReferenceDir(projectId, referenceId), 'ANALYSIS.md'),
    renderReferenceAnalysisMarkdown(analysis),
  );
  await markStaleIfFingerprintChanged(
    projectId,
    referenceId,
    'timeline',
    sourceFingerprint,
  );
  await markStaleIfFingerprintChanged(
    projectId,
    referenceId,
    'framework',
    sourceFingerprint,
  );
  return envelope;
}

export async function writeReferenceTimeline(
  projectId: string,
  referenceId: string,
  raw: unknown,
): Promise<ReferenceArtifactEnvelope<ReferenceTimelineArtifact>> {
  const parsed = parseTimeline(raw);
  const context = await loadReadingContext(projectId, referenceId);
  const analysisEnvelope = await readReferenceEnvelope<ReferenceAnalysis>(
    projectId,
    referenceId,
    'analysis',
  );
  if (!analysisEnvelope) {
    throw new ReferenceReadingValidationError(
      'Write analysis before timeline.',
      'schema',
      'analysis',
    );
  }
  const coverage = computeReferenceCoverage({
    durationMs: context.durationMs,
    evidence: context.evidence,
    packed: context.packed,
  });
  validateReferenceTimeline(parsed, {
    durationMs: context.durationMs,
    evidence: context.evidence,
    analysis: analysisEnvelope.data,
    computedCoverage: coverage,
  });
  const timeline: ReferenceTimelineArtifact = {
    ...parsed,
    coverage,
  };
  const sourceFingerprint = timelineFingerprint({
    analysisFp: analysisEnvelope.sourceFingerprint,
    evidenceIds: timeline.sections.flatMap((section) => section.evidenceIds),
    promptVersion: timeline.promptVersion,
  });
  const envelope: ReferenceArtifactEnvelope<ReferenceTimelineArtifact> = {
    kind: 'timeline',
    referenceId,
    sourceFingerprint,
    derivedFrom: { analysis: analysisEnvelope.sourceFingerprint },
    generatedAt: new Date().toISOString(),
    producer: 'video_reference_write_timeline',
    data: timeline,
  };
  await writeReferenceEnvelope(projectId, envelope);
  await writeReferenceText(
    projectId,
    path.join(getVideoReferenceDir(projectId, referenceId), 'TIMELINE.md'),
    renderReferenceTimelineMarkdown(timeline),
  );
  await markStaleIfFingerprintChanged(
    projectId,
    referenceId,
    'framework',
    sourceFingerprint,
  );
  return envelope;
}

export async function getReferenceReading(
  projectId: string,
  referenceId: string,
): Promise<ReferenceReading> {
  const [analysis, timeline, evidenceEnvelope, context] = await Promise.all([
    readReferenceEnvelope<ReferenceAnalysis>(
      projectId,
      referenceId,
      'analysis',
    ),
    readReferenceEnvelope<ReferenceTimelineArtifact>(
      projectId,
      referenceId,
      'timeline',
    ),
    readReferenceEnvelope<EvidenceItem[]>(projectId, referenceId, 'evidence'),
    loadReadingContext(projectId, referenceId),
  ]);
  return {
    analysis,
    timeline,
    evidence: evidenceEnvelope?.data ?? [],
    coverage: computeReferenceCoverage({
      durationMs: context.durationMs,
      evidence: evidenceEnvelope?.data ?? [],
      packed: context.packed,
    }),
  };
}

export function analysisFingerprint(input: {
  transcriptFp: string | null;
  packedFp: string | null;
  boundariesFp: string | null;
  evidenceIds: string[];
  promptVersion: string;
}): string {
  return referenceFingerprint({
    transcript: input.transcriptFp,
    packed: input.packedFp,
    boundaries: input.boundariesFp,
    evidenceIds: [...new Set(input.evidenceIds)].sort(),
    promptVersion: input.promptVersion,
  });
}

export function timelineFingerprint(input: {
  analysisFp: string;
  evidenceIds: string[];
  promptVersion: string;
}): string {
  return referenceFingerprint({
    analysis: input.analysisFp,
    evidenceIds: [...new Set(input.evidenceIds)].sort(),
    promptVersion: input.promptVersion,
  });
}

async function markStaleIfFingerprintChanged(
  projectId: string,
  referenceId: string,
  kind: Extract<ReferenceArtifactKind, 'timeline' | 'framework'>,
  upstreamFingerprint: string,
): Promise<void> {
  const existing = await readReferenceEnvelope<unknown>(
    projectId,
    referenceId,
    kind,
  );
  if (!existing || existing.stale) return;
  const derived =
    existing.derivedFrom.analysis ?? existing.derivedFrom.timeline;
  if (derived === upstreamFingerprint) return;
  await writeReferenceEnvelope(projectId, { ...existing, stale: true });
}

async function loadReadingContext(
  projectId: string,
  referenceId: string,
): Promise<{
  durationMs: number;
  evidence: EvidenceItem[];
  packed: PackedTranscriptPayload | null;
  transcriptFp: string | null;
  packedFp: string | null;
  boundariesFp: string | null;
}> {
  const reference = await requireReference(projectId, referenceId);
  const [probe, evidence, packed, transcript, boundaries] = await Promise.all([
    readReferenceEnvelope<ReferenceProbe>(projectId, referenceId, 'probe'),
    readReferenceEnvelope<EvidenceItem[]>(projectId, referenceId, 'evidence'),
    readReferenceEnvelope<PackedTranscriptPayload>(
      projectId,
      referenceId,
      'packed-transcript',
    ),
    readReferenceEnvelope(projectId, referenceId, 'transcript'),
    readReferenceEnvelope(projectId, referenceId, 'boundaries'),
  ]);
  return {
    durationMs: probe?.data.durationMs ?? reference.durationMs,
    evidence: evidence?.data ?? [],
    packed: packed?.data ?? null,
    transcriptFp: transcript?.sourceFingerprint ?? null,
    packedFp: packed?.sourceFingerprint ?? null,
    boundariesFp: boundaries?.sourceFingerprint ?? null,
  };
}

function parseAnalysis(raw: unknown): ReferenceAnalysis {
  try {
    return referenceAnalysisSchema.parse(raw);
  } catch (error) {
    throw toReadingError(error);
  }
}

function parseTimeline(raw: unknown): ReferenceTimelineArtifact {
  try {
    return referenceTimelineArtifactSchema.parse(raw);
  } catch (error) {
    throw toReadingError(error);
  }
}

function toReadingError(error: unknown): ReferenceReadingValidationError {
  if (error instanceof ReferenceReadingValidationError) return error;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    const anchor = issue?.path.map(String).join('.') || 'schema';
    return new ReferenceReadingValidationError(
      issue?.message ?? 'Invalid reading payload.',
      issue?.path.includes('confidence') ? 'confidence' : 'schema',
      anchor,
    );
  }
  return new ReferenceReadingValidationError(
    error instanceof Error ? error.message : String(error),
  );
}

async function requireReference(
  projectId: string,
  referenceId: string,
): Promise<VideoReference> {
  const reference = (await getProject(projectId)).videoReferences?.find(
    (item) => item.id === referenceId,
  );
  if (!reference) {
    throw new ReferenceReadingValidationError(
      'Reference not found.',
      'schema',
      'referenceId',
    );
  }
  return reference;
}
