import { describe, expect, it } from 'vitest';

import {
  ProjectSoundtrackSchema,
  SOUNDTRACK_DEFAULT_MUSIC_DB,
  defaultSoundtrackFadeOutSec,
  resolveSoundtrackGains,
} from '@/shared/video/soundtrack';

describe('ProjectSoundtrack model', () => {
  it('accepts an empty soundtrack (no-op) and applies defaults', () => {
    const parsed = ProjectSoundtrackSchema.safeParse({});
    expect(parsed.success).toBe(true);
    expect(resolveSoundtrackGains({}).musicVolumeDb).toBe(
      SOUNDTRACK_DEFAULT_MUSIC_DB,
    );
  });

  it('rejects out-of-range gains', () => {
    const parsed = ProjectSoundtrackSchema.safeParse({ musicVolumeDb: 120 });
    expect(parsed.success).toBe(false);
  });

  it('computes default fade-out as min(1.5, dur/3)', () => {
    expect(defaultSoundtrackFadeOutSec(0)).toBe(0);
    expect(defaultSoundtrackFadeOutSec(3)).toBe(1);
    expect(defaultSoundtrackFadeOutSec(60)).toBe(1.5);
  });
});
