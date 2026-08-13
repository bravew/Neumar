import { describe, expect, it } from 'vitest';

import {
  blurPadBackgroundStyle,
  blurPadForegroundStyle,
} from '@/components/video/preview/RemotionBlurPad';

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
});
