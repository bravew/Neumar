import { describe, expect, it } from 'vitest';

import { shouldTreatArtifactAsOutput } from '@/components/artifacts/output-classification';
import type { Artifact } from '@/components/artifacts/types';

function artifact(path?: string): Artifact {
  return {
    id: path ?? 'content-only',
    name: 'BLAZE_Trailer_v2.mp4',
    type: 'video',
    path,
  };
}

describe('artifact output classification', () => {
  it('keeps staged source media out of Output', () => {
    expect(
      shouldTreatArtifactAsOutput(
        artifact(
          '/Volumes/4TB_WD/_Neumar/sessions/session-current/attachments/BLAZE_Trailer_v2.mp4',
        ),
      ),
    ).toBe(false);
  });

  it('keeps referenced source media out of Output', () => {
    expect(
      shouldTreatArtifactAsOutput(
        artifact(
          '/Volumes/4TB_WD/_Neumar/sessions/session-old/BLAZE_Trailer_v2.mp4',
        ),
      ),
    ).toBe(false);
  });

  it('shows generated media under Output when it is in an output directory', () => {
    expect(
      shouldTreatArtifactAsOutput(
        artifact(
          '/Volumes/4TB_WD/_Neumar/sessions/session-current/output/BLAZE_Trailer_v2_1080p.mp4',
        ),
      ),
    ).toBe(true);
  });

  it('honors explicit Output markers even outside output directories', () => {
    const path = '/Volumes/4TB_WD/_Neumar/sessions/session-current/final.mp4';

    expect(shouldTreatArtifactAsOutput(artifact(path), new Set([path]))).toBe(
      true,
    );
  });
});
