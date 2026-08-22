import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClipEffectsSection } from '@/components/video/clipInspector/ClipEffectsSection';
import en from '@/config/locale/messages/en';
import type { VideoVisualTimelineClip } from '@/shared/types/video';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClipEffectsSection', () => {
  it('adds a versioned effect from the runtime catalog', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '15ef4de3-a29d-4435-aa78-70e0948e5191',
    );
    const updateEffects = vi.fn();

    render(
      <ClipEffectsSection
        clip={clipFixture()}
        labels={en.video.editor.clipInspector}
        updateEffects={updateEffects}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Brightness' }));

    expect(updateEffects).toHaveBeenCalledWith({
      schema: 'neuma.video.clip-effects.v1',
      effects: [
        {
          id: '15ef4de3-a29d-4435-aa78-70e0948e5191',
          version: 1,
          kind: 'brightness',
          params: { amount: 0 },
        },
      ],
    });
  });
});

function clipFixture(): VideoVisualTimelineClip {
  return {
    id: 'clip-video',
    kind: 'video',
    sourceRef: { kind: 'asset', assetId: 'asset-video' },
    startMs: 0,
    durationMs: 2000,
    trimStartMs: 0,
    trimEndMs: 2000,
  };
}
