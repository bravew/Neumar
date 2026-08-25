import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AssetAudioHoverPreview } from '@/components/assets/AssetAudioHoverPreview';
import { AssetVideoHoverPreview } from '@/components/assets/AssetVideoHoverPreview';
import { useAssetPreviewSoundStore } from '@/shared/hooks/useAssetPreviewSound';

import { installLocalStorageMock } from '../helpers/local-storage';
import { renderWithProviders } from '../helpers/render-with-providers';

function stubPlayback(
  element: HTMLMediaElement,
  play: () => Promise<void>,
): void {
  Object.defineProperty(element, 'play', { value: play, configurable: true });
  Object.defineProperty(element, 'pause', {
    value: vi.fn(),
    configurable: true,
  });
  Object.defineProperty(element, 'paused', {
    value: false,
    configurable: true,
  });
}

beforeEach(() => {
  installLocalStorageMock();
  useAssetPreviewSoundStore.setState({ soundEnabled: false });
});

describe('preview sound preference', () => {
  it('starts muted so hovering a list never makes noise', () => {
    const { container } = renderWithProviders(
      <AssetVideoHoverPreview src="http://api.test/clip.mp4" poster={null} />,
    );
    const video = container.querySelector('video')!;
    expect(video.muted).toBe(true);
  });

  it('unmutes the current preview and remembers it for the next one', () => {
    const { container, unmount } = renderWithProviders(
      <AssetVideoHoverPreview src="http://api.test/clip.mp4" poster={null} />,
    );
    const video = container.querySelector('video')!;
    stubPlayback(video, () => Promise.resolve());

    fireEvent.click(
      screen.getByRole('button', { name: 'Play previews with sound' }),
    );
    expect(video.muted).toBe(false);
    expect(localStorage.getItem('neuma.assetPreview.sound')).toBe('on');
    unmount();

    // The next asset hovered starts audible without touching the toggle again.
    const next = renderWithProviders(
      <AssetVideoHoverPreview src="http://api.test/other.mp4" poster={null} />,
    );
    expect(next.container.querySelector('video')!.muted).toBe(false);
  });

  it('plays muted when the browser refuses sound, keeping the preference', async () => {
    const { container } = renderWithProviders(
      <AssetVideoHoverPreview src="http://api.test/clip.mp4" poster={null} />,
    );
    const video = container.querySelector('video')!;
    // Reject the audible attempt, allow the muted retry that follows.
    const play = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
      .mockResolvedValue(undefined);
    stubPlayback(video, play);

    fireEvent.click(
      screen.getByRole('button', { name: 'Play previews with sound' }),
    );
    await Promise.resolve();
    await Promise.resolve();

    // The preview keeps moving...
    expect(video.muted).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
    // ...but the choice the user just made is not silently undone. Their next
    // click unlocks audio, and the preference is still there to apply.
    expect(useAssetPreviewSoundStore.getState().soundEnabled).toBe(true);
  });
});

describe('AssetAudioHoverPreview', () => {
  it('waits for a click while previews are muted', () => {
    const { container } = renderWithProviders(
      <AssetAudioHoverPreview src="http://api.test/track.mp3" />,
    );
    const audio = container.querySelector('audio')!;
    const play = vi.fn().mockResolvedValue(undefined);
    stubPlayback(audio, play);
    expect(play).not.toHaveBeenCalled();
  });

  it('plays on its own once preview sound is on', () => {
    useAssetPreviewSoundStore.setState({ soundEnabled: true });
    const play = vi.fn().mockResolvedValue(undefined);
    const original = window.HTMLMediaElement.prototype.play;
    window.HTMLMediaElement.prototype.play = play;
    try {
      renderWithProviders(
        <AssetAudioHoverPreview src="http://api.test/track.mp3" />,
      );
      expect(play).toHaveBeenCalledTimes(1);
    } finally {
      window.HTMLMediaElement.prototype.play = original;
    }
  });
});
