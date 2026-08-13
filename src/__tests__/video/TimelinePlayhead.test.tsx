import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelinePlayhead } from '@/components/video/timeline/TimelinePlayhead';

describe('TimelinePlayhead', () => {
  it('renders one continuous draggable scrubber at the playhead position', () => {
    const { container } = render(
      <div className="relative h-96">
        <TimelinePlayhead
          playheadMs={1000}
          durationMs={3000}
          headerWidth={144}
          pixelsPerSecond={10}
          ariaLabel="Playhead at 0:01.0"
          onSeek={vi.fn()}
        />
      </div>,
    );

    const playhead = screen.getByRole('slider', {
      name: 'Playhead at 0:01.0',
    });
    expect(playhead).toHaveStyle({ left: '154px' });
    expect(playhead).toHaveClass('top-0');
    expect(playhead).toHaveClass('bottom-0');
    expect(container.querySelector('[data-timeline-playhead]')).toBe(playhead);
  });

  it('seeks while dragging the line', () => {
    const onSeek = vi.fn();
    render(
      <div className="relative h-96">
        <TimelinePlayhead
          playheadMs={1000}
          durationMs={5000}
          headerWidth={144}
          pixelsPerSecond={80}
          ariaLabel="Playhead at 0:01.0"
          onSeek={onSeek}
        />
      </div>,
    );

    const playhead = screen.getByRole('slider', {
      name: 'Playhead at 0:01.0',
    });
    const parent = playhead.parentElement;
    if (!parent) throw new Error('Expected playhead parent.');
    parent.getBoundingClientRect = () =>
      ({
        left: 20,
        top: 0,
        right: 1200,
        bottom: 400,
        width: 1180,
        height: 400,
        x: 20,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    let captured = false;
    playhead.setPointerCapture = () => {
      captured = true;
    };
    playhead.hasPointerCapture = () => captured;
    playhead.releasePointerCapture = () => {
      captured = false;
    };

    fireEvent.pointerDown(playhead, {
      button: 0,
      pointerId: 1,
      clientX: 20 + 144 + 160,
    });
    fireEvent.pointerMove(playhead, {
      pointerId: 1,
      clientX: 20 + 144 + 240,
    });
    fireEvent.pointerUp(playhead, { pointerId: 1 });

    expect(onSeek).toHaveBeenNthCalledWith(1, 2000);
    expect(onSeek).toHaveBeenNthCalledWith(2, 3000);
    expect(captured).toBe(false);
  });
});
