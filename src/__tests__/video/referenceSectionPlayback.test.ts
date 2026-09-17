import { describe, expect, it } from 'vitest';

import {
  activeSectionAt,
  reachedSectionEnd,
} from '@/components/video/reference/sectionPlayback';
import type { VideoReferenceTimelineSection } from '@/shared/types/video';

function section(
  id: string,
  startMs: number,
  endMs: number,
): VideoReferenceTimelineSection {
  return {
    id,
    phase: id,
    startMs,
    endMs,
    anchor: '',
    effect: '',
    confidence: 0.6,
    evidenceIds: [],
    activeSystems: [],
  };
}

const sections = [
  section('cold-open', 0, 15_000),
  section('content-reel', 15_000, 48_000),
  section('close', 152_000, 186_600),
];

describe('reference section playback', () => {
  it('maps the playhead to the section it is inside', () => {
    expect(activeSectionAt(sections, 0)?.id).toBe('cold-open');
    expect(activeSectionAt(sections, 14_999)?.id).toBe('cold-open');
    expect(activeSectionAt(sections, 20_000)?.id).toBe('content-reel');
    expect(activeSectionAt(sections, 186_599)?.id).toBe('close');
  });

  it('claims a boundary for exactly one section', () => {
    // 15000 ends cold-open and starts content-reel; highlighting both would
    // make the list flicker between two rows on every frame.
    expect(activeSectionAt(sections, 15_000)?.id).toBe('content-reel');
  });

  it('returns nothing in a gap or past the end', () => {
    expect(activeSectionAt(sections, 100_000)).toBeNull();
    expect(activeSectionAt(sections, 200_000)).toBeNull();
    expect(activeSectionAt([], 0)).toBeNull();
  });

  it('stops clamped playback at the section end', () => {
    const clamp = section('cold-open', 0, 15_000);
    expect(reachedSectionEnd(clamp, 14_900)).toBe(false);
    expect(reachedSectionEnd(clamp, 15_000)).toBe(true);
    expect(reachedSectionEnd(clamp, 15_200)).toBe(true);
  });

  it('never stops when no section is clamped', () => {
    // Free playback must run to the end of the reference.
    expect(reachedSectionEnd(null, 999_999)).toBe(false);
  });
});
