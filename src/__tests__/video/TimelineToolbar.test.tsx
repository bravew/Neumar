import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/__tests__/helpers/render-with-providers';
import { TIMELINE_ZOOM } from '@/components/video/timeline/timelineMath';
import { TimelineToolbar } from '@/components/video/timeline/TimelineToolbar';
import { useTimelineUiStore } from '@/components/video/timeline/useTimelineUiStore';

describe('TimelineToolbar', () => {
  beforeEach(() => {
    useTimelineUiStore.setState({
      razorToolEnabled: false,
    });
  });

  it('groups editing tools and exposes shortcut tooltips', async () => {
    const user = userEvent.setup();
    renderToolbar();

    const select = screen.getByRole('button', { name: labels.selectTool });
    expect(select).toHaveAttribute('aria-pressed', 'true');
    expect(select).toHaveAttribute('title', `${labels.selectTool} (V)`);

    const razor = screen.getByRole('button', { name: labels.razorTool });
    expect(razor).toHaveAttribute('aria-pressed', 'false');
    expect(razor).toHaveAttribute('title', `${labels.razorTool} (B / C)`);
    await user.click(razor);
    expect(razor).toHaveAttribute('aria-pressed', 'true');
    expect(select).toHaveAttribute('aria-pressed', 'false');

    expect(
      screen.queryByRole('button', { name: labels.splitClip }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: labels.copyClip }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: labels.pasteClip }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: labels.deleteClip }),
    ).not.toBeInTheDocument();
  });

  it('exposes marker creation as a visible toolbar action', async () => {
    const user = userEvent.setup();
    const onAddMarker = vi.fn();
    renderToolbar({ onAddMarker });

    await user.click(screen.getByRole('button', { name: labels.addMarker }));

    expect(onAddMarker).toHaveBeenCalledOnce();
  });
});

function renderToolbar({
  onAddMarker = vi.fn(),
}: {
  onAddMarker?: () => void;
} = {}) {
  return renderWithProviders(
    <TimelineToolbar
      playbackState="stopped"
      pixelsPerSecond={TIMELINE_ZOOM.DEFAULT}
      snappingEnabled
      labels={labels}
      onTogglePlayback={vi.fn()}
      onZoomOut={vi.fn()}
      onZoomIn={vi.fn()}
      onZoomToFit={vi.fn()}
      onResetZoom={vi.fn()}
      onAddVideoTrack={vi.fn()}
      onToggleSnapping={vi.fn()}
      onAddMarker={onAddMarker}
    />,
  );
}

const labels = {
  play: 'Play timeline',
  pause: 'Pause timeline',
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  zoomFit: 'Fit timeline',
  resetZoom: 'Reset zoom',
  addVideoLayer: 'Add video layer',
  addTrack: 'Add track',
  trackKindVideo: 'Video track',
  trackKindBroll: 'B-roll track',
  trackKindOverlay: 'Overlay track',
  trackKindAudioVo: 'Narration track',
  trackKindAudioMusic: 'Music track',
  trackKindAudioSfx: 'SFX track',
  trackKindCaption: 'Caption track',
  trackKindVisualGroup: 'Visual',
  trackKindAudioGroup: 'Audio',
  trackKindOtherGroup: 'Other',
  addCaption: 'Add caption',
  toggleSnapping: 'Toggle snapping',
  addMarker: 'Add marker',
  selectTool: 'Select tool',
  razorTool: 'Razor tool',
  splitClip: 'Split clip at playhead',
  copyClip: 'Copy clip',
  pasteClip: 'Paste clip',
  deleteClip: 'Delete clip',
};
