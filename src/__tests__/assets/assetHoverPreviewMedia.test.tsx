import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssetVideoHoverPreview } from '@/components/assets/AssetVideoHoverPreview';

describe('AssetVideoHoverPreview', () => {
  function renderPreview() {
    const utils = render(
      <AssetVideoHoverPreview src="http://api.test/clip.mp4" poster={null} />,
    );
    const video = utils.container.querySelector('video');
    if (!video) throw new Error('no video element');
    return { ...utils, video };
  }

  function withDuration(video: HTMLVideoElement, seconds: number) {
    Object.defineProperty(video, 'duration', {
      value: seconds,
      configurable: true,
    });
    fireEvent.loadedMetadata(video);
  }

  it('shows no scrub bar until the duration is known', () => {
    const { container } = renderPreview();
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  it('reveals a scrub bar spanning the clip once metadata loads', () => {
    const { container, video } = renderPreview();
    withDuration(video, 12);

    const slider = container.querySelector('input[type="range"]');
    expect(slider).not.toBeNull();
    expect(slider?.getAttribute('max')).toBe('12');
  });

  it('seeks to the dragged position and pauses while dragging', () => {
    const { container, video } = renderPreview();
    // jsdom has no media pipeline; stand in for the parts we drive.
    Object.defineProperty(video, 'paused', {
      value: false,
      configurable: true,
    });
    const pause = vi.fn();
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'pause', { value: pause, configurable: true });
    Object.defineProperty(video, 'play', { value: play, configurable: true });
    withDuration(video, 12);

    const slider = container.querySelector('input[type="range"]')!;
    fireEvent.pointerDown(slider);
    expect(pause).toHaveBeenCalledTimes(1);

    fireEvent.change(slider, { target: { value: '7.5' } });
    expect(video.currentTime).toBe(7.5);

    // Releasing resumes, because it was playing when the drag started.
    fireEvent.pointerUp(slider);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stays paused after a drag that began while paused', () => {
    const { container, video } = renderPreview();
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'play', { value: play, configurable: true });
    Object.defineProperty(video, 'pause', {
      value: vi.fn(),
      configurable: true,
    });
    withDuration(video, 12);

    const slider = container.querySelector('input[type="range"]')!;
    fireEvent.pointerDown(slider);
    fireEvent.pointerUp(slider);
    expect(play).not.toHaveBeenCalled();
  });
});
