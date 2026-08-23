import { fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AssetVideoHoverPreview } from '@/components/assets/AssetVideoHoverPreview';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('AssetVideoHoverPreview', () => {
  function renderPreview() {
    const utils = renderWithProviders(
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

  it('pauses and resumes from the control bar', () => {
    const { container, video, getByRole } = renderPreview();
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn(() => {
      Object.defineProperty(video, 'paused', {
        value: true,
        configurable: true,
      });
      fireEvent.pause(video);
    });
    Object.defineProperty(video, 'paused', {
      value: false,
      configurable: true,
    });
    Object.defineProperty(video, 'play', { value: play, configurable: true });
    Object.defineProperty(video, 'pause', { value: pause, configurable: true });
    // The element reports it started, which is what flips the icon.
    fireEvent.play(video);

    fireEvent.click(getByRole('button', { name: 'Pause preview' }));
    expect(pause).toHaveBeenCalledTimes(1);

    // The control now offers the way back, and the bar stops hiding itself.
    fireEvent.click(getByRole('button', { name: 'Play preview' }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.opacity-100')).not.toBeNull();
  });

  it('goes full screen on the video, with controls so it can be steered', () => {
    const { video, getByRole } = renderPreview();
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'requestFullscreen', {
      value: requestFullscreen,
      configurable: true,
    });

    fireEvent.click(getByRole('button', { name: 'Full screen' }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    // The flyout's own bar is gone in full screen, so the native one stands in.
    expect(video.controls).toBe(true);

    // Leaving full screen restores the quiet preview.
    fireEvent(document, new Event('fullscreenchange'));
    expect(video.controls).toBe(false);
  });

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
