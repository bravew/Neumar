import { describe, expect, it } from 'vitest';

import {
  audioEnvelopeGainAtFrame,
  dbToLinearVolume,
  mapAudioFadeCurveToFfmpeg,
} from '../src/index.js';

describe('audio envelope helpers', () => {
  it('applies mute gates before gain', () => {
    expect(
      audioEnvelopeGainAtFrame({
        absoluteFrame: 0,
        clipGainDb: 24,
        clipMuted: true,
        durationInFrames: 60,
        fps: 30,
        localFrame: 0,
        trackVolumeDb: 24,
      }),
    ).toBe(0);
  });

  it('uses keyframed volume as the clip gain before track volume', () => {
    expect(
      audioEnvelopeGainAtFrame({
        absoluteFrame: 30,
        clipGainDb: 0,
        durationInFrames: 60,
        fps: 30,
        keyframes: [
          {
            property: 'volumeDb',
            keys: [{ atMs: 1000, value: -12 }],
          },
        ],
        localFrame: 30,
        trackVolumeDb: -6,
      }),
    ).toBeCloseTo(dbToLinearVolume(-18), 6);
  });

  it('evaluates non-linear fade curves in frame space', () => {
    const gain = audioEnvelopeGainAtFrame({
      absoluteFrame: 15,
      clipGainDb: 0,
      durationInFrames: 60,
      fadeInCurve: 'equal-power',
      fadeInFrames: 30,
      fps: 30,
      localFrame: 15,
      trackVolumeDb: 0,
    });

    expect(gain).toBeCloseTo(0.725995, 6);
  });

  it('maps envelope curves to FFmpeg fade curve names', () => {
    expect(mapAudioFadeCurveToFfmpeg('linear', 'in')).toBe('tri');
    expect(mapAudioFadeCurveToFfmpeg('equal-power', 'in')).toBe('qsin');
    expect(mapAudioFadeCurveToFfmpeg('equal-power', 'out')).toBe('hsin');
    expect(mapAudioFadeCurveToFfmpeg('ease-in-out', 'out')).toBe('esin');
  });
});
