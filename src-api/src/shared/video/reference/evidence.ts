import path from 'node:path';

import { detectBoundaries } from '@/shared/video/analysis/boundaries';
import { buildLabeledGrid } from '@/shared/video/analysis/labeled-frames';
import {
  packTranscript,
  type PackedTranscriptPayload,
} from '@/shared/video/analysis/pack-transcript';
import { resolvePhraseRange } from '@/shared/video/analysis/phrase-range';
import { transcribeSourceMedia } from '@/shared/video/analysis/transcript';
import { referenceFingerprint } from '@/shared/video/reference/fingerprint';
import {
  ensureReferenceDir,
  readReferenceEnvelope,
  relativeToProject,
  writeReferenceEnvelope,
} from '@/shared/video/reference/store';
import {
  getProject,
  getVideoProjectDir,
  getVideoProjectRoot,
  getVideoSourceAnalysisCacheDirForRoot,
} from '@/shared/video/store';
import type {
  EvidenceItem,
  ReferenceBoundaries,
  ReferenceProbe,
  TranscriptData,
  VideoReference,
} from '@/shared/video/types';

export interface BuildEvidenceInput {
  around?: string;
  occurrence?: number;
  paddingMs?: number;
  everyMs?: number;
  columns?: number;
  rows?: number;
  cellWidth?: number;
  question?: string;
  kind?: 'grid' | 'frames';
  maxCells?: number;
}

/**
 * Decide which timestamps to sample for one evidence grid.
 *
 * `maxCells` is a ceiling on total cells, not a promise of coverage: a long
 * reference at a fine step needs more cells than the ceiling allows. When the
 * ceiling stops sampling early, the returned `range` is narrowed to the
 * coverage actually achieved. That matters because the structured reading, the
 * timeline and the thin-gap check all read `range` — leaving it at the
 * requested end let a grid covering only the opening stretch of a reference
 * claim the whole runtime, so extraction kept reporting gaps that the evidence
 * metadata insisted were covered.
 */
export function planEvidenceSampling(input: {
  range: { startMs: number; endMs: number };
  everyMs: number;
  maxCells: number;
}): {
  sampledAtMs: number[];
  range: { startMs: number; endMs: number };
  truncated: boolean;
} {
  const { everyMs, maxCells } = input;
  const requested = input.range;
  const lastSeekableMs = Math.max(requested.startMs, requested.endMs - 500);
  const sampledAtMs: number[] = [];
  for (
    let at = requested.startMs;
    at <= lastSeekableMs && sampledAtMs.length < maxCells;
    at += everyMs
  ) {
    sampledAtMs.push(Math.round(at));
  }
  const last = sampledAtMs[sampledAtMs.length - 1];
  if (last !== lastSeekableMs && sampledAtMs.length < maxCells) {
    sampledAtMs.push(lastSeekableMs);
  }

  const covered = sampledAtMs[sampledAtMs.length - 1] ?? requested.startMs;
  // One step of slack: sampling stops at `endMs - 500`, so a full sweep lands
  // short of `endMs` by design and must not count as truncated.
  const truncated = covered < lastSeekableMs - everyMs;
  return {
    sampledAtMs,
    range: truncated
      ? { startMs: requested.startMs, endMs: covered }
      : requested,
    truncated,
  };
}

export interface BuildEvidenceResult {
  item: EvidenceItem;
  sampledAtMs: number[];
  cacheHit: boolean;
}

export async function loadReferenceProbe(
  projectId: string,
  referenceId: string,
): Promise<ReferenceProbe | null> {
  const envelope = await readReferenceEnvelope<ReferenceProbe>(
    projectId,
    referenceId,
    'probe',
  );
  return envelope?.data ?? null;
}

export async function transcribeReference(
  projectId: string,
  referenceId: string,
): Promise<TranscriptData> {
  const project = await getProject(projectId);
  const reference = await requireReference(projectId, referenceId);
  const root = getVideoProjectRoot(projectId);
  const result = await transcribeSourceMedia({
    project,
    source: {
      id: reference.id,
      mediaItemId: reference.id,
      origin: 'upload',
      contentHash: reference.contentHash,
      analysisStatus: 'running',
      createdAt: reference.createdAt,
    },
    asset: {
      id: reference.id,
      kind: 'video',
      source: 'user',
      path: reference.mediaPath,
      metadata: { durationMs: reference.durationMs },
    },
    workspaceRoot: root,
    cacheDir: getVideoSourceAnalysisCacheDirForRoot(
      root,
      projectId,
      reference.contentHash,
    ),
  });
  await writeReferenceEnvelope(projectId, {
    kind: 'transcript',
    referenceId,
    sourceFingerprint: referenceFingerprint({
      contentHash: reference.contentHash,
    }),
    derivedFrom: {
      probe: referenceFingerprint({ contentHash: reference.contentHash }),
    },
    generatedAt: result.artifact.generatedAt,
    producer: result.transcript.engine,
    data: result.transcript,
  });
  await writePackedTranscriptForReference(
    projectId,
    reference,
    result.transcript,
  );
  return result.transcript;
}

export async function loadPackedTranscriptForReference(
  projectId: string,
  referenceId: string,
): Promise<PackedTranscriptPayload | null> {
  const envelope = await readReferenceEnvelope<PackedTranscriptPayload>(
    projectId,
    referenceId,
    'packed-transcript',
  );
  return envelope?.data ?? null;
}

export async function writePackedTranscriptForReference(
  projectId: string,
  reference: VideoReference,
  transcript: TranscriptData,
): Promise<PackedTranscriptPayload> {
  const payload = packTranscript({
    source: {
      id: reference.id,
      mediaItemId: reference.id,
      origin: 'upload',
      contentHash: reference.contentHash,
      analysisStatus: 'done',
      createdAt: reference.createdAt,
    },
    transcript,
  });
  await writeReferenceEnvelope(projectId, {
    kind: 'packed-transcript',
    referenceId: reference.id,
    sourceFingerprint: referenceFingerprint({
      contentHash: reference.contentHash,
    }),
    derivedFrom: { transcript: referenceFingerprint(transcript) },
    generatedAt: new Date().toISOString(),
    producer: transcript.engine,
    data: payload,
  });
  return payload;
}

export async function detectReferenceBoundaries(
  projectId: string,
  referenceId: string,
  options: {
    threshold?: number;
    maxCandidates?: number;
    method?: 'select' | 'scdet';
  } = {},
): Promise<ReferenceBoundaries> {
  const reference = await requireReference(projectId, referenceId);
  const mediaPath = path.join(
    getVideoProjectDir(projectId),
    reference.mediaPath,
  );
  const boundaries = await detectBoundaries({
    mediaPath,
    workDir: getVideoProjectRoot(projectId),
    ...options,
  });
  await writeReferenceEnvelope(projectId, {
    kind: 'boundaries',
    referenceId,
    sourceFingerprint: referenceFingerprint({
      contentHash: reference.contentHash,
    }),
    derivedFrom: {
      probe: referenceFingerprint({ contentHash: reference.contentHash }),
    },
    generatedAt: new Date().toISOString(),
    producer: 'ffmpeg',
    data: boundaries,
  });
  return boundaries;
}

export async function buildEvidence(
  projectId: string,
  referenceId: string,
  input: BuildEvidenceInput = {},
): Promise<BuildEvidenceResult> {
  const reference = await requireReference(projectId, referenceId);
  const archive = await ensureReferenceDir(projectId, referenceId);
  const mediaPath = path.join(
    getVideoProjectDir(projectId),
    reference.mediaPath,
  );
  const transcript = (
    await readReferenceEnvelope<TranscriptData>(
      projectId,
      referenceId,
      'transcript',
    )
  )?.data;
  const packed = (
    await readReferenceEnvelope<PackedTranscriptPayload>(
      projectId,
      referenceId,
      'packed-transcript',
    )
  )?.data;

  const durationMs = reference.durationMs;
  let range = { startMs: 0, endMs: durationMs };
  if (input.around) {
    if (!transcript?.words.length) {
      throw new Error('Phrase-driven evidence requires a transcript.');
    }
    const resolved = resolvePhraseRange({
      words: transcript.words,
      phrase: input.around,
      occurrence: input.occurrence,
      paddingMs: input.paddingMs ?? 400,
      durationMs,
    });
    range = { startMs: resolved.startMs, endMs: resolved.endMs };
  }

  const everyMs = Math.max(50, input.everyMs ?? 1000);
  const maxCells = Math.max(1, input.maxCells ?? 48);
  const columns = Math.max(1, input.columns ?? 4);
  const cellWidth = Math.max(32, input.cellWidth ?? 320);
  const plan = planEvidenceSampling({ range, everyMs, maxCells });
  const sampledAtMs = plan.sampledAtMs;
  range = plan.range;

  const fingerprint = referenceFingerprint({
    contentHash: reference.contentHash,
    kind: input.kind ?? 'grid',
    range,
    sampledAtMs,
    labels: { time: true, words: Boolean(transcript) },
    grid: { columns, cellWidth },
  });

  const existing = await readReferenceEnvelope<EvidenceItem[]>(
    projectId,
    referenceId,
    'evidence',
  );
  const cached = existing?.data.find(
    (item) =>
      referenceFingerprint({
        contentHash: reference.contentHash,
        kind: item.kind,
        range: item.range,
        sampledAtMs: item.sampledAtMs,
        labels: item.labels,
        grid: item.grid
          ? { columns: item.grid.columns, cellWidth: item.grid.cellWidth }
          : undefined,
      }) === fingerprint,
  );
  if (cached) {
    return { item: cached, sampledAtMs: cached.sampledAtMs, cacheHit: true };
  }

  const wordsByTime =
    transcript?.words ??
    packed?.phrases.flatMap((phrase) =>
      phrase.text.split(' ').map((text, index) => ({
        text,
        startMs: phrase.startMs,
        endMs: phrase.endMs,
        index,
      })),
    );
  const samples = sampledAtMs.map((atMs) => ({
    atMs,
    wordLabel: wordAt(wordsByTime ?? [], atMs),
  }));

  const grid = await buildLabeledGrid({
    mediaPath,
    workDir: getVideoProjectRoot(projectId),
    destinationDir: path.join(archive, 'evidence'),
    filePrefix: `grid-${fingerprint.slice(0, 10)}`,
    samples,
    columns,
    rows: input.rows,
    cellWidth,
  });

  const item: EvidenceItem = {
    id: `ev-${fingerprint.slice(0, 12)}`,
    kind: 'grid',
    name: input.around
      ? `phrase-${range.startMs}-${range.endMs}`
      : `coarse-${range.startMs}-${range.endMs}`,
    range,
    sampledAtMs: grid.sampledAtMs,
    paths: grid.paths.map((filePath) => relativeToProject(projectId, filePath)),
    samples: grid.sampledAtMs.map((atMs, index) => {
      const pageSize = grid.columns * grid.rows;
      const pageIndex = Math.floor(index / pageSize);
      return {
        id: `ev-${fingerprint.slice(0, 12)}-s${index + 1}`,
        atMs,
        page: pageIndex + 1,
        cell: index % pageSize,
        gridPath: relativeToProject(projectId, grid.paths[pageIndex]!),
      };
    }),
    labels: { time: true, words: Boolean(transcript) },
    grid: {
      columns: grid.columns,
      rows: grid.rows,
      cellWidth: grid.cellWidth,
      pages: grid.pages,
    },
    ...(input.question ? { question: input.question } : {}),
  };

  await writeReferenceEnvelope(projectId, {
    kind: 'evidence',
    referenceId,
    sourceFingerprint: fingerprint,
    derivedFrom: {
      probe: referenceFingerprint({ contentHash: reference.contentHash }),
    },
    generatedAt: new Date().toISOString(),
    producer: 'ffmpeg',
    data: [...(existing?.data ?? []), item],
  });

  return { item, sampledAtMs: item.sampledAtMs, cacheHit: false };
}

async function requireReference(
  projectId: string,
  referenceId: string,
): Promise<VideoReference> {
  const reference = (await getProject(projectId)).videoReferences?.find(
    (item) => item.id === referenceId,
  );
  if (!reference) throw new Error('Reference not found.');
  return reference;
}

function wordAt(
  words: Array<{ text: string; startMs: number; endMs: number }>,
  atMs: number,
): string | undefined {
  return words.find((word) => word.startMs <= atMs && atMs < word.endMs)?.text;
}
