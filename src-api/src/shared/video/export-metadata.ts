import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runFFmpeg, validatePath } from '@/shared/services/ffmpeg';
import { createLogger } from '@/shared/utils/logger';
import {
  type AttributionCredit,
  buildCreditLine,
  collectProjectAttributions,
} from '@/shared/video/attribution';
import { YOUTUBE_UNVERIFIED_PROVIDER } from '@/shared/video/plugins/atoms/broll/types';
import type { VideoProject } from '@/shared/video/types';

// Phase 7 governance — attribution + AI-disclosure on the exported MP4.
// Two surfaces, both fed by `collectProjectAttributions`:
//   1. MP4 container metadata (title/artist/comment) embedded via a fast
//      stream-copy ffmpeg pass — no re-encode, codec-independent.
//   2. A machine-readable `<output>.credits.json` disclosure sidecar, mirroring
//      the image provenance-writer sidecar convention.
// C2PA Content Credentials signing is structured-compatible but deferred (see
// dev-doc/html-video/06-06/09-slice-J).

const logger = createLogger('VideoExportMetadata');

/** Stable marker so downstream tools can detect Neuma-declared AI media. */
export const AI_DISCLOSURE = 'AI-generated with Neuma' as const;

export interface ExportMetadata {
  title: string;
  artist?: string;
  comment: string;
  credits: AttributionCredit[];
  warnings: string[];
  aiGenerated: true;
}

/** Build the export metadata (container tags + disclosure) for a project. */
export function buildExportMetadata(project: VideoProject): ExportMetadata {
  const credits = collectProjectAttributions(project);
  const warnings = collectExportWarnings(project);
  const creditLine = buildCreditLine(credits);
  const disclosure = creditLine
    ? `${AI_DISCLOSURE}. ${creditLine}`
    : AI_DISCLOSURE;
  const comment =
    warnings.length > 0
      ? `${disclosure}. Warnings: ${warnings.join(' ')}`
      : disclosure;
  return {
    title: project.name,
    ...(creditLine ? { artist: creditLine } : {}),
    comment,
    credits,
    warnings,
    aiGenerated: true,
  };
}

/** The disclosure sidecar payload written next to the MP4. */
export interface DisclosureSidecar {
  schemaVersion: 1;
  projectId: string;
  aiGenerated: true;
  disclosure: string;
  credits: AttributionCredit[];
  warnings: string[];
  generatedAt: string;
}

function metadataArgs(metadata: ExportMetadata): string[] {
  const tags: Array<[string, string]> = [
    ['title', metadata.title],
    ['comment', metadata.comment],
  ];
  if (metadata.artist) tags.push(['artist', metadata.artist]);
  return tags.flatMap(([key, value]) => ['-metadata', `${key}=${value}`]);
}

/**
 * Embed `metadata` into the MP4 container with a stream-copy pass (no
 * re-encode), then atomically replace the original. Path-independent: runs after
 * loudness normalization regardless of which renderer produced the file.
 */
export async function embedExportMetadata(input: {
  root: string;
  outputPath: string;
  metadata: ExportMetadata;
  signal?: AbortSignal;
}): Promise<void> {
  const outputPath = validatePath(input.outputPath, input.root, 'write');
  const parsed = path.parse(outputPath);
  const tempPath = validatePath(
    path.join(parsed.dir, `${parsed.name}.meta-${randomUUID()}${parsed.ext}`),
    input.root,
    'write',
  );
  try {
    const result = await runFFmpeg(
      [
        '-i',
        outputPath,
        '-map',
        '0',
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        ...metadataArgs(input.metadata),
        tempPath,
      ],
      { abortSignal: input.signal },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Export metadata embed failed: ${result.stderr.slice(0, 500)}`,
      );
    }
    await fs.rename(tempPath, outputPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

/** Path of the disclosure sidecar for a given MP4 output. */
export function disclosureSidecarPath(outputPath: string): string {
  return `${outputPath}.credits.json`;
}

/** Write the machine-readable disclosure + credits sidecar next to the MP4. */
export async function writeDisclosureSidecar(input: {
  root: string;
  outputPath: string;
  projectId: string;
  metadata: ExportMetadata;
  generatedAt: string;
}): Promise<string> {
  const sidecarAbs = validatePath(
    disclosureSidecarPath(input.outputPath),
    input.root,
    'write',
  );
  const payload: DisclosureSidecar = {
    schemaVersion: 1,
    projectId: input.projectId,
    aiGenerated: true,
    disclosure: AI_DISCLOSURE,
    credits: input.metadata.credits,
    warnings: input.metadata.warnings,
    generatedAt: input.generatedAt,
  };
  await fs.writeFile(sidecarAbs, `${JSON.stringify(payload, null, 2)}\n`);
  logger.info(`Wrote disclosure sidecar for project ${input.projectId}`);
  return sidecarAbs;
}

function collectExportWarnings(project: VideoProject): string[] {
  return project.assets
    .filter(
      (asset) => asset.provenance?.provider === YOUTUBE_UNVERIFIED_PROVIDER,
    )
    .map((asset) => {
      const label =
        asset.provenance?.sourceDisplayName ??
        asset.provenance?.sourceUrl ??
        asset.id;
      return `YouTube source "${label}" has unverified rights; confirm license and attribution before publishing.`;
    });
}
