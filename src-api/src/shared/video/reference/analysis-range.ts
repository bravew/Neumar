import fs from 'node:fs/promises';
import path from 'node:path';

import { probeFile, validateInputFile } from '@/shared/services/ffmpeg';
import {
  getReference,
  toReferenceProbe,
} from '@/shared/video/reference/acquire';
import { referenceFingerprint } from '@/shared/video/reference/fingerprint';
import {
  REFERENCE_ANALYSIS_MAX_MS,
  trimMediaFile,
} from '@/shared/video/reference/media-trim';
import { readReferenceRun } from '@/shared/video/reference/run';
import {
  referenceMediaDir,
  relativeToProject,
  validatedReferencePath,
  writeReferenceEnvelope,
} from '@/shared/video/reference/store';
import {
  getVideoProjectDir,
  getVideoProjectRoot,
  getVideoReferenceDir,
  hashFile,
  updateProjectDocument,
} from '@/shared/video/store';
import type { VideoProject, VideoReference } from '@/shared/video/types';

export {
  REFERENCE_ANALYSIS_MAX_MS,
  defaultAnalysisRange,
} from '@/shared/video/reference/media-trim';

export class ReferenceAnalysisRangeError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid-range' | 'too-long' | 'busy' = 'invalid-range',
  ) {
    super(message);
    this.name = 'ReferenceAnalysisRangeError';
  }
}

export async function setReferenceAnalysisRange(
  projectId: string,
  referenceId: string,
  range: { startMs: number; endMs: number },
): Promise<{ project: VideoProject; reference: VideoReference }> {
  const reference = await getReference(projectId, referenceId);
  const run = await readReferenceRun(projectId, referenceId);
  if (
    run &&
    (run.status === 'queued' ||
      run.status === 'running' ||
      run.status === 'waiting')
  ) {
    throw new ReferenceAnalysisRangeError(
      'Cancel the running analysis before changing the analysis range.',
      'busy',
    );
  }

  const sourceDurationMs = reference.sourceDurationMs ?? reference.durationMs;
  const startMs = Math.round(range.startMs);
  const endMs = Math.round(range.endMs);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs
  ) {
    throw new ReferenceAnalysisRangeError(
      'The analysis range is invalid.',
      'invalid-range',
    );
  }
  if (endMs > sourceDurationMs) {
    throw new ReferenceAnalysisRangeError(
      'The analysis range extends past the source video.',
      'invalid-range',
    );
  }
  if (endMs - startMs > REFERENCE_ANALYSIS_MAX_MS) {
    throw new ReferenceAnalysisRangeError(
      `The analysis range cannot exceed ${REFERENCE_ANALYSIS_MAX_MS / 1000}s.`,
      'too-long',
    );
  }

  const projectRoot = getVideoProjectRoot(projectId);
  const sourceAbsolute = validateInputFile(
    path.join(
      getVideoProjectDir(projectId),
      reference.sourceMediaPath ?? reference.mediaPath,
    ),
    projectRoot,
  );
  const mediaDir = referenceMediaDir(projectId, referenceId);
  await fs.mkdir(mediaDir, { recursive: true });
  const analysisAbsolute = validatedReferencePath(
    projectId,
    path.join(mediaDir, 'analysis.mp4'),
  );
  await trimMediaFile(sourceAbsolute, analysisAbsolute, startMs, endMs);

  const probed = await probeFile(analysisAbsolute, projectRoot, {
    allowExternalMedia: false,
  });
  const probe = toReferenceProbe(probed);
  const contentHash = await hashFile(analysisAbsolute);
  const mediaPath = relativeToProject(projectId, analysisAbsolute);

  // The prior reading/framework/run are all derived from media that no
  // longer exists at that content hash — keep only the media directory and
  // start the next analysis clean rather than risk a stale artifact whose
  // fingerprint check doesn't cover this case.
  await clearReferenceArtifacts(projectId, referenceId);
  await writeReferenceEnvelope(projectId, {
    kind: 'probe',
    referenceId,
    sourceFingerprint: referenceFingerprint({ contentHash }),
    derivedFrom: {},
    generatedAt: new Date().toISOString(),
    producer: 'ffmpeg',
    data: probe,
  });

  const project = await updateProjectDocument(projectId, (current) => ({
    ...current,
    videoReferences: (current.videoReferences ?? []).map((item) =>
      item.id === referenceId
        ? {
            ...item,
            mediaPath,
            contentHash,
            durationMs: probe.durationMs,
            sourceMediaPath: item.sourceMediaPath ?? item.mediaPath,
            sourceDurationMs: item.sourceDurationMs ?? item.durationMs,
            analysisRange: { startMs, endMs },
            artifactIds: ['probe'],
          }
        : item,
    ),
    updatedAt: new Date().toISOString(),
  }));
  const updated = project.videoReferences?.find(
    (item) => item.id === referenceId,
  );
  if (!updated) {
    throw new ReferenceAnalysisRangeError(
      'Reference disappeared while setting its analysis range.',
      'invalid-range',
    );
  }
  return { project, reference: updated };
}

async function clearReferenceArtifacts(
  projectId: string,
  referenceId: string,
): Promise<void> {
  const dir = getVideoReferenceDir(projectId, referenceId);
  let entries: Array<{ name: string }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.name !== 'media')
      .map((entry) =>
        fs.rm(path.join(dir, entry.name), { recursive: true, force: true }),
      ),
  );
}
