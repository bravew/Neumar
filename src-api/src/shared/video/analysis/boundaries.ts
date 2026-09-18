import { runFFmpeg, validateInputFile } from '@/shared/services/ffmpeg';
import {
  REFERENCE_BOUNDARY_CAVEAT,
  type BoundaryCandidate,
  type ReferenceBoundaries,
} from '@/shared/video/types';

export const DEFAULT_SELECT_THRESHOLD = 0.2;
export const DEFAULT_SCDET_THRESHOLD = 8;
export const DEFAULT_MAX_BOUNDARY_CANDIDATES = 48;

export interface DetectBoundariesInput {
  mediaPath: string;
  workDir: string;
  sampleRate?: number;
  threshold?: number;
  maxCandidates?: number;
  method?: 'select' | 'scdet';
}

export async function detectBoundaries(
  input: DetectBoundariesInput,
): Promise<ReferenceBoundaries> {
  const mediaPath = validateInputFile(input.mediaPath, input.workDir, {
    allowExternalMedia: true,
  });
  const method = input.method ?? 'select';
  const maxCandidates = Math.max(
    1,
    Math.floor(input.maxCandidates ?? DEFAULT_MAX_BOUNDARY_CANDIDATES),
  );
  const threshold =
    input.threshold ??
    (method === 'scdet' ? DEFAULT_SCDET_THRESHOLD : DEFAULT_SELECT_THRESHOLD);
  const sampleRate = input.sampleRate ?? 1;
  const raw =
    method === 'scdet'
      ? await detectScdet(mediaPath, threshold)
      : await detectSelect(mediaPath, threshold);
  const sorted = [...raw].sort((left, right) => right.score - left.score);
  const capped = sorted.length > maxCandidates;
  const kept = capped ? sorted.slice(0, maxCandidates) : sorted;
  kept.sort((left, right) => left.atMs - right.atMs);
  return {
    sampleRate,
    threshold,
    maxCandidates,
    candidates: kept,
    capped,
    caveat: REFERENCE_BOUNDARY_CAVEAT,
  };
}

async function detectSelect(
  mediaPath: string,
  threshold: number,
): Promise<BoundaryCandidate[]> {
  const result = await runFFmpeg([
    '-i',
    mediaPath,
    '-vf',
    `select='gt(scene,${threshold})',showinfo`,
    '-fps_mode',
    'vfr',
    '-f',
    'null',
    '-',
  ]);
  const candidates: BoundaryCandidate[] = [];
  for (const line of result.stderr.split('\n')) {
    if (!line.includes('pts_time:') || !line.includes('n:')) continue;
    const timeMatch = line.match(/pts_time:([0-9.]+)/);
    if (!timeMatch?.[1]) continue;
    const scoreMatch = line.match(/scene_score:([0-9.]+)/);
    candidates.push({
      atMs: Math.round(Number(timeMatch[1]) * 1000),
      score: scoreMatch?.[1] ? Number(scoreMatch[1]) : threshold,
      method: 'select',
    });
  }
  return candidates;
}

async function detectScdet(
  mediaPath: string,
  threshold: number,
): Promise<BoundaryCandidate[]> {
  const result = await runFFmpeg([
    '-i',
    mediaPath,
    '-vf',
    `scdet=threshold=${threshold}`,
    '-an',
    '-f',
    'null',
    '-',
  ]);
  const candidates: BoundaryCandidate[] = [];
  const pattern =
    /lavfi\.scd\.score:\s*([0-9.]+),\s*lavfi\.scd\.time:\s*([0-9.]+)/g;
  let match: RegExpExecArray | null = pattern.exec(result.stderr);
  while (match) {
    const score = Number(match[1]);
    const atSec = Number(match[2]);
    if (score >= threshold) {
      candidates.push({
        atMs: Math.round(atSec * 1000),
        score,
        method: 'scdet',
      });
    }
    match = pattern.exec(result.stderr);
  }
  return candidates;
}
