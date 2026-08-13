import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FrameControlsSection } from '@/components/video/clipInspector/FrameControlsSection';
import type { ClipInspectorLabels } from '@/components/video/clipInspector/types';
import type { VideoClipTransform } from '@/shared/types/video';

// Minimal labels — FrameControlsSection only reads these fields.
const labels = {
  sections: { frame: 'Frame' },
  frameFill: 'Fill',
  frameContain: 'Contain',
  frameCenter: 'Center',
  frameFocus: 'Focus',
  frameNudge: 'Nudge',
  frameFocusLabels: {
    nw: 'Top left',
    n: 'Top',
    ne: 'Top right',
    w: 'Left',
    c: 'Center',
    e: 'Right',
    sw: 'Bottom left',
    s: 'Bottom',
    se: 'Bottom right',
  },
} as unknown as ClipInspectorLabels;

// Portrait media in a landscape frame leaves vertical headroom, so a nudge is
// not clamped back to the centered 0.5 and its direction is observable.
const baseTransform: VideoClipTransform = {
  fit: 'contain',
  scale: 2,
  positionX: 0.5,
  positionY: 0.5,
};

function nudgeButtonsWithin() {
  // Scope to the Nudge grid: focus labels (Top/Bottom/...) are shared with the
  // Focus grid, so query inside the section that owns the nudge arrows.
  const nudgeSection = screen.getByText('Nudge').parentElement as HTMLElement;
  return within(nudgeSection);
}

describe('FrameControlsSection nudge arrows', () => {
  it('pans north (up) toward the top of the source: larger positionY', async () => {
    const patchTransforms = vi.fn();
    render(
      <FrameControlsSection
        aspectRatio="16:9"
        labels={labels}
        sourceFrame={{ width: 1080, height: 1920 }}
        transforms={baseTransform}
        patchTransforms={patchTransforms}
      />,
    );

    await userEvent.click(nudgeButtonsWithin().getByLabelText('Top'));

    expect(patchTransforms).toHaveBeenCalledTimes(1);
    const next = patchTransforms.mock
      .calls[0][0] as Partial<VideoClipTransform>;
    expect(next.positionY).toBeGreaterThan(0.5);
  });

  it('pans south (down) toward the bottom of the source: smaller positionY', async () => {
    const patchTransforms = vi.fn();
    render(
      <FrameControlsSection
        aspectRatio="16:9"
        labels={labels}
        sourceFrame={{ width: 1080, height: 1920 }}
        transforms={baseTransform}
        patchTransforms={patchTransforms}
      />,
    );

    await userEvent.click(nudgeButtonsWithin().getByLabelText('Bottom'));

    expect(patchTransforms).toHaveBeenCalledTimes(1);
    const next = patchTransforms.mock
      .calls[0][0] as Partial<VideoClipTransform>;
    expect(next.positionY).toBeLessThan(0.5);
  });
});
