import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type ProjectSoundtrack,
  ProjectSoundtrackSchema,
} from '@/shared/video/soundtrack';
import type { VideoProject } from '@/shared/video/types';

describe('VideoProject.soundtrack', () => {
  it('typechecks as an optional ProjectSoundtrack', () => {
    expectTypeOf<
      NonNullable<VideoProject['soundtrack']>
    >().toEqualTypeOf<ProjectSoundtrack>();
  });

  it('round-trips through JSON without losing fields', () => {
    const soundtrack: ProjectSoundtrack = {
      musicAssetId: 'media:abc',
      narrationAssetId: 'media:def',
      musicVolumeDb: -18,
      narrationVolumeDb: 0,
      narrationByFrame: { intro_logo: 'Hello there.' },
      fadeInSec: 0.5,
      fadeOutSec: 1.2,
    };
    const project = {
      // Only the fields we care about — the type is structural enough that
      // we don't need to construct a fully-populated VideoProject.
      soundtrack,
    } satisfies Pick<VideoProject, 'soundtrack'>;

    const roundtripped = JSON.parse(JSON.stringify(project)) as typeof project;
    expect(roundtripped.soundtrack).toEqual(soundtrack);

    // Schema also accepts the same shape (the agent path validates before
    // writing onto the project).
    expect(
      ProjectSoundtrackSchema.safeParse(roundtripped.soundtrack).success,
    ).toBe(true);
  });

  it('treats absence as legitimate (no migration needed for older projects)', () => {
    const project = {} satisfies Pick<VideoProject, 'soundtrack'>;
    expect(project.soundtrack).toBeUndefined();
  });
});
