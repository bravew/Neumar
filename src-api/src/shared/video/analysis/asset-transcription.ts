import { analyzeSource, ensureSourceForAsset, getProject } from '../store';
import type { SourceMedia, SourceMediaAnalysis, VideoProject } from '../types';

export class AssetTranscriptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly project?: VideoProject,
  ) {
    super(message);
    this.name = 'AssetTranscriptionError';
  }
}

type AssetTranscriptionResult = {
  project: VideoProject;
  source: SourceMedia;
  analysis: SourceMediaAnalysis;
};

// A double click or another viewer may request the same asset while recognition
// is running. Share that work rather than launching competing model sessions.
const pending = new Map<string, Promise<AssetTranscriptionResult>>();

export function transcribeProjectAsset(
  projectId: string,
  assetId: string,
): Promise<AssetTranscriptionResult> {
  const key = `${projectId}:${assetId}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const task = transcribeAsset(projectId, assetId).finally(() =>
    pending.delete(key),
  );
  pending.set(key, task);
  return task;
}

async function transcribeAsset(
  projectId: string,
  assetId: string,
): Promise<AssetTranscriptionResult> {
  const project = await getProject(projectId);
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset)
    throw new AssetTranscriptionError('asset-not-found', 'Asset not found');
  if (
    (asset.kind !== 'video' && asset.kind !== 'audio') ||
    !asset.metadata.audioTrackCount
  ) {
    throw new AssetTranscriptionError(
      'no-audio',
      'This asset has no audio to transcribe.',
    );
  }
  const source = await ensureSourceForAsset(projectId, assetId);
  if (!source) {
    throw new AssetTranscriptionError(
      'source-unavailable',
      'The source file is unavailable.',
    );
  }
  // This action is explicitly local. Project cloud defaults must not turn a
  // local button into an unannounced upload. Retry degraded caches after setup.
  const result = await analyzeSource(projectId, source.id, {
    provider: 'local',
    force: true,
  });
  if (!result.analysis.transcript?.words.length) {
    const artifact = result.project.analysisArtifacts?.find(
      (item) =>
        item.kind === 'transcript-ranges' && item.sourceMediaId === source.id,
    );
    const reason = artifact?.metadata?.reason;
    const detail = artifact?.metadata?.error;
    throw new AssetTranscriptionError(
      typeof reason === 'string' ? reason : 'timed-transcript-unavailable',
      typeof detail === 'string'
        ? detail
        : 'Transcription did not produce word timestamps. Choose a local model that supports timed speech.',
      result.project,
    );
  }
  return { ...result, source };
}
