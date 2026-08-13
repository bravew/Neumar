import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { VividOverlayLayer } from '@/components/video/preview/overlays/VividOverlayLayer';
import { buildVividOverlayEntries } from '@/components/video/preview/overlays/vividOverlayPreviewModel';
import type { RemotionPreviewData } from '@/components/video/preview/remotionPreviewData';
import type { VideoTimeline } from '@/shared/types/video';

const hostInstances: Array<{
  options: Record<string, unknown>;
  seek: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('@/shared/video/overlays/html/sandboxHost', () => ({
  createOverlaySandboxHost: vi.fn((options: Record<string, unknown>) => {
    const instance = {
      options,
      iframe: document.createElement('iframe'),
      ready: Promise.resolve(),
      seek: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    };
    hostInstances.push(instance);
    return instance;
  }),
}));

const FPS = 30;

function timelineFixture(): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    durationMs: 6000,
    fps: FPS,
    tracks: [
      {
        id: 'track-overlay',
        kind: 'overlay',
        name: 'Overlay',
        muted: false,
        locked: false,
        order: 3,
        clips: [
          {
            id: 'fx-1',
            kind: 'effect',
            effectType: 'vivid-overlay',
            sourceRef: {
              kind: 'asset',
              assetId: 'vivid-overlay-preset:html.marker-highlight',
            },
            startMs: 1000,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
            params: {
              presetId: 'html.marker-highlight',
              backend: 'html',
              controls: { text: 'Layer!' },
            },
          },
        ],
      },
    ],
  } as VideoTimeline;
}

function dataFixture(): RemotionPreviewData {
  return {
    compositionWidth: 1280,
    compositionHeight: 720,
    durationInFrames: 180,
    fps: FPS,
    visualClips: [],
    audioClips: [],
    captions: [],
    vividOverlays: buildVividOverlayEntries(timelineFixture(), FPS),
  };
}

const geometry = {
  canvasWidth: 1280,
  canvasHeight: 720,
  centerX: 640,
  centerY: 360,
  scale: 0.5,
  viewportWidth: 800,
  viewportHeight: 450,
};

beforeEach(() => {
  hostInstances.length = 0;
});

describe('VividOverlayLayer', () => {
  it('mounts a trusted host for overlays active at the frame and seeks local time', async () => {
    render(
      <VividOverlayLayer
        data={dataFixture()}
        enabled={true}
        frame={60}
        geometry={geometry}
      />,
    );
    // Host creation resolves the document asynchronously.
    await waitFor(() => expect(hostInstances).toHaveLength(1));
    expect(hostInstances[0]!.options.trusted).toBe(true);
    expect(String(hostInstances[0]!.options.srcdoc)).toContain(
      '__neumaOverlaySeek',
    );
    // frame 60, clip from frame 30 -> local 30 frames = 1000ms
    await waitFor(() =>
      expect(hostInstances[0]!.seek).toHaveBeenCalledWith(1000),
    );
  });

  it('mounts nothing when disabled or when no overlay is active', () => {
    const { rerender } = render(
      <VividOverlayLayer
        data={dataFixture()}
        enabled={false}
        frame={60}
        geometry={geometry}
      />,
    );
    expect(hostInstances).toHaveLength(0);
    rerender(
      <VividOverlayLayer
        data={dataFixture()}
        enabled={true}
        frame={0}
        geometry={geometry}
      />,
    );
    expect(hostInstances).toHaveLength(0);
  });

  it('disposes the host when the playhead leaves the clip', async () => {
    const { rerender } = render(
      <VividOverlayLayer
        data={dataFixture()}
        enabled={true}
        frame={60}
        geometry={geometry}
      />,
    );
    await waitFor(() => expect(hostInstances).toHaveLength(1));
    rerender(
      <VividOverlayLayer
        data={dataFixture()}
        enabled={true}
        frame={150}
        geometry={geometry}
      />,
    );
    await waitFor(() => expect(hostInstances[0]!.dispose).toHaveBeenCalled());
  });

  it('positions the composition-space container from the viewport geometry', () => {
    const { container } = render(
      <VividOverlayLayer
        data={dataFixture()}
        enabled={true}
        frame={60}
        geometry={geometry}
      />,
    );
    const inner = container.querySelector(
      '[data-vivid-overlay-layer] > div',
    ) as HTMLDivElement;
    // left = 800/2 - 640*0.5 = 80; top = 450/2 - 360*0.5 = 45
    expect(inner.style.transform).toBe('translate(80px, 45px) scale(0.5)');
    expect(inner.style.width).toBe('1280px');
    expect(inner.style.height).toBe('720px');
  });
});
