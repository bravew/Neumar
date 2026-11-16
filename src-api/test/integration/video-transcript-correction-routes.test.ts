import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Transcript documents are file-backed. Only the optional SQLite workspace
// lookup is mocked, so these tests exercise the real lock, store and route.
vi.mock('@/shared/db', () => ({
  getDatabase: () => ({
    prepare: () => ({ get: () => undefined, run: () => undefined }),
  }),
}));
vi.mock('@/shared/db/operations', () => ({ getSetting: () => undefined }));

import { videoRoutes } from '@/app/api/video';

import { STT_CAPTION_ORIGIN } from '@/shared/video/caption-retime';
import {
  getProject,
  patchSourceTranscript,
  writeProject,
} from '@/shared/video/store';
import type { CaptionTimelineClip, VideoProject } from '@/shared/video/types';

let workDir: string;
const initial = {
  schemaVersion: 2,
  revision: 1,
  id: 'transcript-correction-route',
  name: 'Transcript',
  template: 'explainer',
  assets: [],
  sources: [{ id: 's', mediaItemId: 'a' }],
  sourceAnalyses: [
    {
      id: 'analysis',
      sourceId: 's',
      transcript: {
        engine: 'test',
        words: [{ text: 'helo', startMs: 0, endMs: 500 }],
        segments: [{ text: 'helo', startMs: 0, endMs: 500 }],
      },
    },
  ],
} as unknown as VideoProject;
const correction = {
  index: 0,
  text: 'Hello',
  startMs: 0,
  expectedText: 'helo',
};

beforeEach(async () => {
  workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'transcript-correction-routes-'),
  );
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  await writeProject(initial, { snapshot: false });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

function patch(corrections: unknown[]) {
  return videoRoutes.request(`/projects/${initial.id}/sources/s/transcript`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corrections }),
  });
}

describe('transcript correction persistence and routes', () => {
  it('serializes competing corrections and rejects the stale one without overwriting', async () => {
    const results = await Promise.allSettled([
      patchSourceTranscript(initial.id, 's', { corrections: [correction] }),
      patchSourceTranscript(initial.id, 's', {
        corrections: [{ ...correction, text: 'Hey' }],
      }),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(results[1]).toMatchObject({ reason: { code: 'stale-word' } });
    const stored = await getProject(initial.id);
    expect(stored.sourceAnalyses![0]!.transcript!.words[0]).toEqual({
      text: 'Hello',
      startMs: 0,
      endMs: 500,
    });
  });

  it('requires expectedText at the HTTP boundary', async () => {
    const { expectedText: _expected, ...unguarded } = correction;
    const response = await patch([unguarded]);
    expect(response.status).toBe(400);
    expect(
      (await getProject(initial.id)).sourceAnalyses![0]!.transcript!.words[0]!
        .text,
    ).toBe('helo');
  });

  it('returns 409 for stale text with the same timestamp', async () => {
    expect((await patch([correction])).status).toBe(200);
    const response = await patch([{ ...correction, text: 'Hey' }]);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'stale-word' });
    expect(
      (await getProject(initial.id)).sourceAnalyses![0]!.transcript!.words[0]!
        .text,
    ).toBe('Hello');
  });

  it('accepts text-only removal but rejects multi-token corrections', async () => {
    expect((await patch([{ ...correction, text: 'two words' }])).status).toBe(
      400,
    );
    expect((await patch([{ ...correction, text: '' }])).status).toBe(200);
    const stored = await getProject(initial.id);
    expect(stored.sourceAnalyses![0]!.transcript!.words[0]).toEqual({
      text: '',
      startMs: 0,
      endMs: 500,
    });
  });

  it('keeps a correction batch atomic if one expected word is stale', async () => {
    const response = await patch([correction, { ...correction, text: 'Hey' }]);
    expect(response.status).toBe(409);
    expect(
      (await getProject(initial.id)).sourceAnalyses![0]!.transcript!.words[0]!
        .text,
    ).toBe('helo');
  });

  it('rewrites the joined cue text when one fragment of a split word is corrected', async () => {
    // Generation stores "Tra" | "nsformer." as two caption words and joins
    // them in the cue text; the PATCH route is how the transcript panel
    // corrects one of them.
    const split = [
      { text: 'model', startMs: 0, endMs: 500 },
      { text: 'Tra', startMs: 500, endMs: 700 },
      { text: 'nsformer.', startMs: 700, endMs: 1000 },
    ];
    const caption: CaptionTimelineClip = {
      id: 'cap',
      kind: 'caption',
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
      trimEndMs: 1000,
      text: 'model Transformer.',
      words: split,
      sourceRef: { kind: 'asset', assetId: 'a' },
      sourceAnchor: {
        sourceMediaId: 'a',
        sourceElementId: 's',
        sourceStartMs: 0,
        sourceEndMs: 1000,
      },
      params: { origin: STT_CAPTION_ORIGIN, sourceId: 's' },
    };
    const project: VideoProject = {
      ...initial,
      sourceAnalyses: [
        {
          ...initial.sourceAnalyses![0]!,
          transcript: {
            ...initial.sourceAnalyses![0]!.transcript!,
            words: split,
            segments: [
              {
                id: 'seg',
                text: 'model Transformer.',
                startMs: 0,
                endMs: 1000,
              },
            ],
          },
        },
      ],
      timeline: {
        schema: 'neuma.video.timeline.v1',
        fps: 30,
        durationMs: 1000,
        tracks: [
          {
            id: 'v',
            kind: 'video',
            name: 'V',
            muted: false,
            locked: false,
            order: 0,
            clips: [
              {
                id: 'clip',
                kind: 'video',
                sourceRef: { kind: 'asset', assetId: 'a' },
                startMs: 0,
                durationMs: 1000,
                trimStartMs: 0,
                trimEndMs: 1000,
              },
            ],
          },
          {
            id: 'c',
            kind: 'caption',
            name: 'C',
            muted: false,
            locked: false,
            order: 1,
            clips: [caption],
          },
        ],
      },
    };
    await writeProject(project, { snapshot: false });

    const response = await patch([
      { index: 1, text: 'Tara', startMs: 500, expectedText: 'Tra' },
    ]);

    expect(response.status).toBe(200);
    const stored = await getProject(initial.id);
    const cue = stored.timeline!.tracks[1]!.clips[0] as CaptionTimelineClip;
    expect(cue.words!.map((word) => word.text)).toEqual([
      'model',
      'Tara',
      'nsformer.',
    ]);
    expect(cue.text).toBe('model Taransformer.');
  });
});
