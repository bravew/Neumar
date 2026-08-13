import {
  defaultSoundtrackFadeOutSec,
  resolveSoundtrackGains,
  SOUNDTRACK_DEFAULT_MUSIC_DB,
  SOUNDTRACK_DEFAULT_NARRATION_DB,
} from '@/shared/video/soundtrack';

import type { EvalCase } from '../types';

// Phase 7 gate — the soundtrack mux ducks music under narration by default and
// applies the default music fade-out. Deterministic gain/fade contract (the
// ffmpeg wiring itself is covered by soundtrack-mux.test.ts).

const evalCase: EvalCase = {
  id: 'video-soundtrack-ducking',
  name: 'Soundtrack ducks music under narration by default',
  tier: 'gate',
  touchfiles: ['src-api/src/shared/video/soundtrack.ts'],
  budget: { maxUsd: 0, timeoutMs: 10_000 },
  run: () => {
    const defaults = resolveSoundtrackGains({});
    const explicit = resolveSoundtrackGains({
      musicVolumeDb: -6,
      narrationVolumeDb: -2,
    });
    const fadeAt30 = defaultSoundtrackFadeOutSec(30);
    const fadeAt3 = defaultSoundtrackFadeOutSec(3);

    const duckedByDefault =
      defaults.musicVolumeDb === SOUNDTRACK_DEFAULT_MUSIC_DB &&
      defaults.narrationVolumeDb === SOUNDTRACK_DEFAULT_NARRATION_DB &&
      defaults.musicVolumeDb < defaults.narrationVolumeDb;
    const explicitPassThrough =
      explicit.musicVolumeDb === -6 && explicit.narrationVolumeDb === -2;
    // min(1.5, dur/3): capped at 1.5s for long clips, dur/3 for short ones.
    const fadeOk = fadeAt30 === 1.5 && fadeAt3 === 1;

    const passed = duckedByDefault && explicitPassThrough && fadeOk;
    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? `music ${defaults.musicVolumeDb}dB under narration ${defaults.narrationVolumeDb}dB`
        : `ducked=${duckedByDefault} passthrough=${explicitPassThrough} fade=${fadeOk}`,
      metrics: {
        musicDb: defaults.musicVolumeDb,
        narrationDb: defaults.narrationVolumeDb,
        fadeAt30,
      },
    };
  },
};

export default evalCase;
