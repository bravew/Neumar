import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transcribeProjectAsset } from '@/shared/video/analysis/asset-transcription';

const store = vi.hoisted(() => ({
  getProject: vi.fn(),
  ensureSourceForAsset: vi.fn(),
  analyzeSource: vi.fn(),
}));
vi.mock('@/shared/video/store', () => store);

const source = { id: 'source', mediaItemId: 'asset' };
const project = {
  id: 'project',
  assets: [{ id: 'asset', kind: 'video', metadata: { audioTrackCount: 1 } }],
};
const result = {
  project,
  analysis: {
    transcript: { words: [{ text: 'hello', startMs: 0, endMs: 100 }] },
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  store.getProject.mockResolvedValue(project);
  store.ensureSourceForAsset.mockResolvedValue(source);
  store.analyzeSource.mockResolvedValue(result);
});

describe('existing asset transcription', () => {
  it('registers the existing asset and requests local transcription with a fresh retry', async () => {
    expect(await transcribeProjectAsset('project', 'asset')).toEqual({
      ...result,
      source,
    });
    expect(store.ensureSourceForAsset).toHaveBeenCalledWith('project', 'asset');
    expect(store.analyzeSource).toHaveBeenCalledWith('project', 'source', {
      provider: 'local',
      force: true,
    });
  });

  it('shares concurrent recognition requests', async () => {
    const first = transcribeProjectAsset('project', 'asset');
    const second = transcribeProjectAsset('project', 'asset');
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(store.analyzeSource).toHaveBeenCalledTimes(1);
  });

  it('reports the model setup error rather than a successful empty transcript', async () => {
    store.analyzeSource.mockResolvedValue({
      analysis: { transcript: { words: [] } },
      project: {
        ...project,
        analysisArtifacts: [
          {
            kind: 'transcript-ranges',
            sourceMediaId: 'source',
            metadata: {
              reason: 'local-model-not-ready',
              error: 'Download the timed model.',
            },
          },
        ],
      },
    });
    await expect(
      transcribeProjectAsset('project', 'asset'),
    ).rejects.toMatchObject({
      code: 'local-model-not-ready',
      message: 'Download the timed model.',
    });
    // Failed requests leave no stuck entry; retry can proceed after setup.
    store.analyzeSource.mockResolvedValue(result);
    await expect(
      transcribeProjectAsset('project', 'asset'),
    ).resolves.toMatchObject(result);
  });

  it('rejects missing assets and silent video without running recognition', async () => {
    await expect(
      transcribeProjectAsset('project', 'missing'),
    ).rejects.toMatchObject({ code: 'asset-not-found' });
    store.getProject.mockResolvedValue({
      ...project,
      assets: [
        { id: 'asset', kind: 'video', metadata: { audioTrackCount: 0 } },
      ],
    });
    await expect(
      transcribeProjectAsset('project', 'asset'),
    ).rejects.toMatchObject({ code: 'no-audio' });
    expect(store.analyzeSource).not.toHaveBeenCalled();
  });
});
