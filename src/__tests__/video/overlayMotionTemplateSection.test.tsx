import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OverlayMotionTemplateSection } from '@/components/video/clipInspector/OverlayMotionTemplateSection';
import { LanguageProvider } from '@/shared/providers/language-provider';
import type { VideoEffectTimelineClip } from '@/shared/types/video';

function renderSection(updateClip = vi.fn()) {
  const clip: VideoEffectTimelineClip = {
    id: 'clip-overlay-1',
    kind: 'effect',
    effectType: 'vivid-overlay',
    sourceRef: {
      kind: 'asset',
      assetId: 'vivid-overlay-preset:html.marker-highlight',
    },
    startMs: 0,
    durationMs: 2500,
    trimStartMs: 0,
    trimEndMs: 2500,
    params: {
      presetId: 'html.marker-highlight',
      backend: 'html',
      controls: { text: 'Highlight this', color: '#ffd166' },
      loop: 'hold',
    },
  };
  render(
    <LanguageProvider>
      <OverlayMotionTemplateSection
        category="callout"
        clip={clip}
        updateClip={updateClip}
      />
    </LanguageProvider>,
  );
  return updateClip;
}

describe('OverlayMotionTemplateSection', () => {
  it('applies the selected template as keyframes and params provenance', () => {
    const updateClip = renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Apply motion' }));

    expect(updateClip).toHaveBeenCalledTimes(1);
    const patch = updateClip.mock
      .calls[0]?.[0] as Partial<VideoEffectTimelineClip>;
    expect(patch.keyframes?.map((track) => track.property)).toEqual([
      'opacity',
      'positionY',
    ]);
    expect(patch.params).toMatchObject({
      motionTemplate: {
        source: 'motion-template',
        templateId: 'entrance.fade-up',
        strength: 'normal',
        affectedProperties: ['opacity', 'positionY'],
      },
    });
  });
});
