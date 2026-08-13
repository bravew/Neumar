import { describe, expect, it } from 'vitest';

import { detectModelCapabilities } from '@/shared/lib/model-capabilities';

describe('model capability detection', () => {
  it.each([
    ['claude-opus-5', ['chat', 'vision', 'reasoning', 'code']],
    ['claude-fable-5', ['chat', 'vision', 'reasoning', 'code']],
    ['claude-mythos-5', ['chat', 'vision', 'reasoning', 'code']],
    ['claude-sonnet-5', ['chat', 'vision', 'code', 'reasoning']],
    ['claude-opus-4-8', ['chat', 'vision', 'reasoning', 'code']],
  ])(
    'detects known Claude frontier capabilities for %s',
    (model, capabilities) => {
      expect(detectModelCapabilities(model)).toEqual(capabilities);
    },
  );

  it.each([
    ['doubao-seedance-2-0-260128', ['video']],
    ['senseaudio-image-2.0-260319', ['image']],
    ['sensenova-u1-fast', ['image']],
    ['senseaudio-asr-1.0-260319', ['audio']],
    ['senseaudio-tts-1.5-260319', ['audio']],
    ['senseaudio-music-1.0-260319', ['audio']],
  ])('detects non-chat capabilities for %s', (model, capabilities) => {
    expect(detectModelCapabilities(model)).toEqual(capabilities);
  });

  it('distinguishes K3 video understanding from video generation', () => {
    expect(detectModelCapabilities('kimi-k3')).toEqual([
      'chat',
      'reasoning',
      'code',
      'vision',
      'video-input',
    ]);
  });
});
