import { createElement } from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  blurPadBackgroundStyle,
  blurPadForegroundStyle,
  RemotionVideo,
} from '@/components/video/preview/RemotionBlurPad';

const mediaVideoProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const legacyVideoProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@remotion/media', async () => {
  const React = await import('react');
  return {
    Video: (props: Record<string, unknown>) => {
      mediaVideoProps.push(props);
      return React.createElement('div', { 'data-testid': 'media-video' });
    },
  };
});

vi.mock('remotion', async (original) => {
  const React = await import('react');
  const actual = await original<typeof import('remotion')>();
  return {
    ...actual,
    Html5Video: (props: Record<string, unknown>) => {
      legacyVideoProps.push(props);
      return React.createElement('div', { 'data-testid': 'legacy-video' });
    },
  };
});

afterEach(() => {
  cleanup();
  mediaVideoProps.length = 0;
  legacyVideoProps.length = 0;
});

describe('RemotionBlurPad', () => {
  it('stacks the sharp foreground above the blurred background', () => {
    const background = blurPadBackgroundStyle({ filter: 'brightness(1)' });
    const foreground = blurPadForegroundStyle({ filter: 'brightness(1)' });

    expect(background).toMatchObject({
      filter: 'brightness(1) blur(28px)',
      inset: 0,
      objectFit: 'cover',
      position: 'absolute',
      zIndex: 0,
    });
    expect(foreground).toMatchObject({
      filter: 'brightness(1)',
      inset: 0,
      objectFit: 'contain',
      objectPosition: 'center',
      position: 'absolute',
      zIndex: 1,
    });
  });

  it('uses @remotion/media with explicit legacy fallback', () => {
    render(
      createElement(RemotionVideo, {
        muted: false,
        preservePitch: true,
        src: 'clip.mp4',
        style: { objectFit: 'contain', opacity: 0.8 },
        trimAfter: 60,
        trimBefore: 10,
        useRemotionMedia: true,
      }),
    );

    expect(mediaVideoProps).toHaveLength(1);
    expect(mediaVideoProps[0]).toMatchObject({
      disallowFallbackToOffthreadVideo: false,
      fallbackOffthreadVideoProps: {
        pauseWhenBuffering: true,
        preservePitch: true,
      },
      objectFit: 'contain',
      style: { opacity: 0.8 },
    });
    expect(legacyVideoProps).toHaveLength(0);
  });

  it('uses Html5Video when the rollback flag is disabled', () => {
    render(
      createElement(RemotionVideo, {
        muted: true,
        src: 'clip.mp4',
        trimAfter: 60,
        trimBefore: 10,
        useRemotionMedia: false,
      }),
    );

    expect(legacyVideoProps).toHaveLength(1);
    expect(legacyVideoProps[0]).toMatchObject({ pauseWhenBuffering: true });
    expect(mediaVideoProps).toHaveLength(0);
  });
});
