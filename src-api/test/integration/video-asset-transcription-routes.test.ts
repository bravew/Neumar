import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/db', () => ({
  getDatabase: () => ({
    prepare: () => ({ get: () => undefined, run: () => undefined }),
  }),
}));
vi.mock('@/shared/db/operations', () => ({ getSetting: () => undefined }));
const recognize = vi.hoisted(() => vi.fn());
vi.mock('@/shared/video/analysis/transcript', () => ({
  transcribeSourceMedia: recognize,
}));

import { videoRoutes } from '@/app/api/video';

import { getProject, writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

let workDir: string;
const initial = {
  schemaVersion: 2,
  revision: 1,
  id: 'asset-transcription-route',
  name: 'Video',
  template: 'explainer',
  assets: [
    {
      id: 'asset',
      kind: 'video',
      origin: 'external',
      path: '/unused/external.mp4',
      source: 'user',
      metadata: {
        audioTrackCount: 1,
        durationMs: 1000,
        contentHash: 'registered-hash',
      },
    },
  ],
  sources: [],
  sourceAnalyses: [],
} as unknown as VideoProject;

beforeEach(async () => {
  workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'asset-transcription-routes-'),
  );
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  recognize.mockReset();
  await writeProject(initial, { snapshot: false });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

function transcribe(assetId = 'asset') {
  return videoRoutes.request(
    `/projects/${initial.id}/assets/${assetId}/transcribe`,
    { method: 'POST' },
  );
}

describe('asset transcription route', () => {
  it('registers a linked asset without copying it and returns a word-timed transcript', async () => {
    recognize.mockImplementation(async ({ source }) => ({
      transcript: {
        engine: 'Local:parakeet',
        words: [{ text: 'hello', startMs: 100, endMs: 300 }],
        segments: [],
      },
      artifact: {
        id: 'transcript',
        kind: 'transcript-ranges',
        sourceMediaId: source.id,
        generatedAt: new Date().toISOString(),
      },
      providerKey: 'local',
      degraded: false,
    }));
    const response = await transcribe();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.source.mediaItemId).toBe('asset');
    expect(payload.analysis.transcript.words).toHaveLength(1);
    expect(payload.project.assets).toEqual(initial.assets);
    expect(recognize).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'local', force: true }),
    );
    expect((await getProject(initial.id)).sources).toHaveLength(1);
  });

  it('returns actionable setup failure and persists the registered source for retry', async () => {
    recognize.mockImplementation(async ({ source }) => ({
      transcript: { engine: 'Local:parakeet', words: [], segments: [] },
      artifact: {
        id: 'transcript',
        kind: 'transcript-ranges',
        sourceMediaId: source.id,
        generatedAt: new Date().toISOString(),
        metadata: {
          reason: 'local-model-not-ready',
          error: 'Download the local model.',
        },
      },
      providerKey: 'local',
      degraded: true,
    }));
    const response = await transcribe();
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'local-model-not-ready',
      error: 'Download the local model.',
    });
    expect((await getProject(initial.id)).sources).toHaveLength(1);
  });

  it('returns 404 for an unknown asset', async () => {
    expect((await transcribe('missing')).status).toBe(404);
    expect(recognize).not.toHaveBeenCalled();
  });
});
