import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Caption } from '@/components/video/preview/RemotionCaption';
import { buildRemotionPreviewData } from '@/components/video/preview/remotionPreviewData';
import type { VideoProject } from '@/shared/types/video';

const frame = vi.hoisted(() => ({ current: 0 }));

vi.mock('remotion', async (original) => {
  const actual = await original<typeof import('remotion')>();
  return { ...actual, useCurrentFrame: () => frame.current };
});

afterEach(() => {
  cleanup();
  frame.current = 0;
});

type Animation = 'tiktok-word' | 'hormozi-bold' | 'karaoke';

describe('live preview caption with a transcriber-split word', () => {
  it.each<Animation>(['tiktok-word', 'hormozi-bold', 'karaoke'])(
    'draws "Tra" + "nsformer." as one %s word span',
    (animation) => {
      const data = buildRemotionPreviewData(projectWith(animation), '16:9');
      const caption = data.captions[0];
      if (!caption) throw new Error('Expected one preview caption');
      expect(caption.words?.map((word) => word.text)).toEqual([
        'The',
        'model',
        'Transformer.',
      ]);
      const glued = caption.words![2]!;

      // The first frame of the run, while "Tra" is being spoken, and the last.
      for (const at of [glued.fromFrame, glued.toFrame - 1]) {
        frame.current = at;
        const { container, unmount } = render(<Caption caption={caption} />);
        const spans = [
          ...container.querySelectorAll('span[style*="inline-block"]'),
        ].map((span) => span.textContent);
        expect(spans).toContain('Transformer.');
        expect(spans).not.toContain('Tra');
        expect(spans).not.toContain('nsformer.');
        unmount();
      }
    },
  );
});

function projectWith(animation: Animation): VideoProject {
  return {
    id: 'project-glued',
    name: 'Glued',
    template: 'explainer',
    prompt: '',
    assets: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      durationMs: 3000,
      fps: 24,
      tracks: [
        {
          id: 'track-caption-main',
          kind: 'caption',
          name: 'Captions',
          muted: false,
          locked: false,
          order: 30,
          clips: [
            {
              id: 'clip-caption',
              kind: 'caption',
              sourceRef: { kind: 'asset', assetId: 'asset-video' },
              startMs: 0,
              durationMs: 2400,
              trimStartMs: 0,
              trimEndMs: 2400,
              text: 'The model Transformer.',
              words: [
                { text: 'The', startMs: 0, endMs: 300 },
                { text: 'model', startMs: 300, endMs: 700 },
                { text: 'Tra', startMs: 700, endMs: 900 },
                { text: 'nsformer.', startMs: 900, endMs: 1400 },
              ],
              style: { position: 'bottom', animation },
            },
          ],
        },
      ],
    },
    render: { status: 'idle', updatedAt: '2026-11-16T00:00:00.000Z' },
    budget: { capUsd: 5, spentUsd: 0 },
    outputs: [],
    createdAt: '2026-11-16T00:00:00.000Z',
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
}
