import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineMarkerInspector } from '@/components/video/timeline/TimelineMarkerInspector';
import { TimelineRuler } from '@/components/video/timeline/TimelineRuler';
import type { VideoTimelineMarker } from '@/shared/types/video';

describe('TimelineMarkerInspector', () => {
  it('commits marker label, color, chapter, comment, and delete actions', () => {
    const onUpdateMarker = vi.fn();
    const onDeleteMarker = vi.fn();
    render(
      <TimelineMarkerInspector
        marker={markerFixture}
        headerWidth={144}
        timelineWidth={800}
        pixelsPerSecond={10}
        labels={labels}
        onUpdateMarker={onUpdateMarker}
        onDeleteMarker={onDeleteMarker}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Marker label'), {
      target: { value: 'Chapter 1' },
    });
    fireEvent.blur(screen.getByLabelText('Marker label'));
    fireEvent.click(screen.getByLabelText('Marker color: purple'));
    fireEvent.click(screen.getByLabelText('Chapter marker'));
    fireEvent.change(screen.getByLabelText('Comment'), {
      target: { value: 'Intro starts' },
    });
    fireEvent.blur(screen.getByLabelText('Comment'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete marker' }));

    expect(onUpdateMarker).toHaveBeenCalledWith('marker-1', {
      label: 'Chapter 1',
      timeMs: 1000,
      comment: '',
    });
    expect(onUpdateMarker).toHaveBeenCalledWith('marker-1', {
      color: 'purple',
    });
    expect(onUpdateMarker).toHaveBeenCalledWith('marker-1', {
      isChapter: true,
    });
    expect(onUpdateMarker).toHaveBeenCalledWith('marker-1', {
      label: 'Chapter 1',
      timeMs: 1000,
      comment: 'Intro starts',
    });
    expect(onDeleteMarker).toHaveBeenCalledWith('marker-1');
  });
});

describe('TimelineRuler markers', () => {
  it('selects marker buttons without seeking the ruler', () => {
    const onSeek = vi.fn();
    const onSelectMarker = vi.fn();
    render(
      <TimelineRuler
        durationMs={3000}
        headerWidth={144}
        timelineWidth={800}
        pixelsPerSecond={10}
        markers={[markerFixture]}
        selectedMarkerId={null}
        markerLabels={labels}
        ariaLabel="Seek timeline"
        onSeek={onSeek}
        onSelectMarker={onSelectMarker}
        onUpdateMarker={vi.fn()}
        onDeleteMarker={vi.fn()}
      />,
    );

    const markerButton = screen.getByRole('button', { name: 'Beat' });

    fireEvent.pointerDown(markerButton);

    expect(onSeek).not.toHaveBeenCalled();
    expect(onSelectMarker).not.toHaveBeenCalled();

    fireEvent.click(markerButton);

    expect(onSelectMarker).toHaveBeenCalledWith('marker-1');
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('keeps the selected marker editor above the playhead layer', async () => {
    const { container } = render(
      <TimelineRuler
        durationMs={3000}
        headerWidth={144}
        timelineWidth={800}
        pixelsPerSecond={10}
        markers={[markerFixture]}
        selectedMarkerId="marker-1"
        markerLabels={labels}
        ariaLabel="Seek timeline"
        onSeek={vi.fn()}
        onSelectMarker={vi.fn()}
        onUpdateMarker={vi.fn()}
        onDeleteMarker={vi.fn()}
      />,
    );

    expect(container.firstElementChild).toHaveClass('z-[70]');
    expect(screen.getByTestId('timeline-marker-marker-1')).toHaveClass(
      'z-[85]',
    );
    await waitFor(() => {
      expect(screen.getByTestId('timeline-marker-editor')).toHaveClass(
        'z-[100]',
      );
    });
  });
});

const markerFixture: VideoTimelineMarker = {
  id: 'marker-1',
  timeMs: 1000,
  label: 'Beat',
  color: 'blue',
};

const labels = {
  label: 'Marker label',
  timeMs: 'Marker time',
  color: 'Marker color',
  chapter: 'Chapter marker',
  comment: 'Comment',
  delete: 'Delete marker',
  close: 'Close marker editor',
};
