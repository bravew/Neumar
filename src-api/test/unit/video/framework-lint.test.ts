import { describe, expect, it } from 'vitest';

import {
  FrameworkLintError,
  lintFramework,
} from '@/shared/video/reference/framework-lint';
import type { VideoFramework } from '@/shared/video/types';

const CLEAN: VideoFramework = {
  id: 'fw-1',
  version: 1,
  displayName: 'Explainer spine',
  category: 'explainer',
  hook: 'cold-open',
  pace: 'medium',
  aspectRatios: ['16:9'],
  totalDuration: { typicalMs: 4000, minMs: 2400, maxMs: 7200 },
  sections: [
    {
      id: 'fw-sec-1',
      role: 'hook',
      purpose: 'Orient the viewer to the claim.',
      timing: {
        proportion: 1,
        minMs: 600,
        maxMs: 1800,
        observedMs: 1000,
      },
      slots: [
        {
          id: 'slot-1',
          kind: 'a-roll',
          constraints: {},
          fallback: { kind: 'ask-user' },
          required: true,
        },
      ],
      systemIds: ['sys-caption'],
      pacing: { cutsPerMinute: 0, shortestHoldMs: 1000, longestHoldMs: 1000 },
      confidence: 0.8,
      derivedFromSectionIds: ['sec-1'],
    },
  ],
  systems: [
    {
      id: 'sys-caption',
      role: 'caption',
      behavior: { entry: 'fade in', active: 'hold', exit: 'cut' },
      spans: ['fw-sec-1'],
    },
  ],
  provenance: {
    referenceId: 'ref-read1',
    derivedFromArtifacts: ['analysis', 'timeline'],
    extractedBy: 'test',
    extractedAt: '2026-09-15T00:00:00.000Z',
  },
  confidence: 0.8,
};

describe('framework-lint', () => {
  it('passes a clean framework', () => {
    expect(() =>
      lintFramework(CLEAN, { referenceId: 'ref-read1', contentHash: 'abc123' }),
    ).not.toThrow();
  });

  it('fails on a reference archive path', () => {
    try {
      lintFramework(
        {
          ...CLEAN,
          sections: [
            {
              ...CLEAN.sections[0]!,
              purpose: 'See references/ref-read1/media/source.mp4',
            },
          ],
        },
        { referenceId: 'ref-read1' },
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'archive-path' });
    }
  });

  it('fails on a leaked contentHash', () => {
    try {
      lintFramework(
        { ...CLEAN, displayName: 'hash abc123def' },
        { referenceId: 'ref-read1', contentHash: 'abc123def' },
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'content-hash' });
    }
  });

  it('fails on a data URI', () => {
    try {
      lintFramework(
        {
          ...CLEAN,
          sections: [
            {
              ...CLEAN.sections[0]!,
              purpose: 'data:image/png;base64,AAAA',
            },
          ],
        },
        { referenceId: 'ref-read1' },
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ code: 'data-uri' });
    }
  });

  it('fails when a textTemplate repeats a transcript run', () => {
    const transcript =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet';
    try {
      lintFramework(
        {
          ...CLEAN,
          sections: [
            {
              ...CLEAN.sections[0]!,
              slots: [
                {
                  id: 'slot-tts',
                  kind: 'narration',
                  constraints: {},
                  fallback: {
                    kind: 'tts-narration',
                    textTemplate:
                      'alpha bravo charlie delta echo foxtrot golf hotel',
                  },
                  required: true,
                },
              ],
            },
          ],
        },
        {
          referenceId: 'ref-read1',
          transcript: {
            engine: 'test',
            language: 'en',
            words: transcript.split(' ').map((text, index) => ({
              text,
              startMs: index * 200,
              endMs: index * 200 + 180,
            })),
            segments: [],
          },
        },
      );
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(FrameworkLintError);
      expect(error).toMatchObject({ code: 'transcript-run' });
    }
  });
});
