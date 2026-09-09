import { describe, expect, it } from 'vitest';

import {
  applyBleedCorrection,
  BLEED_CORRECTION_CONFIDENCE_THRESHOLD,
  estimateBleed,
  toSpeechRanges,
  type ActivityFrame,
} from '@/shared/video/multicam/activity';

const WINDOW_MS = 100;

function frames(values: number[]): ActivityFrame[] {
  return values.map((raw, index) => ({
    atReferenceMs: index * WINDOW_MS,
    raw,
    corrected: raw,
  }));
}

/** Ana speaks alone; Ben's mic picks up 30% of her. */
function bleedingPair(soloWindows: number) {
  const ana: number[] = [];
  const ben: number[] = [];
  for (let index = 0; index < soloWindows; index += 1) {
    ana.push(0.9);
    ben.push(0.27);
  }
  return [
    { participantId: 'p-ana', frames: frames(ana) },
    { participantId: 'p-ben', frames: frames(ben) },
  ];
}

describe('bleed estimation', () => {
  it('measures leakage from windows where exactly one participant speaks', () => {
    const estimates = estimateBleed(bleedingPair(30));

    expect(estimates['p-ben']?.bleed['p-ana']).toBeCloseTo(0.3, 2);
    expect(estimates['p-ben']?.confidence).toBe(1);
  });

  it('reports low confidence when nobody ever speaks alone', () => {
    const estimates = estimateBleed([
      { participantId: 'p-ana', frames: frames([0.9, 0.9, 0.9]) },
      { participantId: 'p-ben', frames: frames([0.9, 0.9, 0.9]) },
    ]);

    // Everybody talking at once gives no clean window to calibrate from.
    expect(estimates['p-ana']?.confidence).toBe(0);
    expect(estimates['p-ana']?.bleed).toEqual({});
  });

  it('scales confidence with how many clean windows the recording gave', () => {
    expect(estimateBleed(bleedingPair(5))['p-ben']?.confidence).toBeCloseTo(
      0.25,
      6,
    );
    expect(estimateBleed(bleedingPair(20))['p-ben']?.confidence).toBe(1);
  });
});

describe('bleed correction', () => {
  it('subtracts measured leakage once calibration is confident', () => {
    const participants = [
      { participantId: 'p-ana', frames: frames([0.9]) },
      { participantId: 'p-ben', frames: frames([0.27]) },
    ];
    const corrected = applyBleedCorrection(participants, {
      'p-ana': { bleed: {}, confidence: 1 },
      'p-ben': { bleed: { 'p-ana': 0.3 }, confidence: 1 },
    });

    const ben = corrected.find((entry) => entry.participantId === 'p-ben')!;
    expect(ben.bleedCorrectionApplied).toBe(true);
    expect(ben.frames[0]?.corrected).toBeCloseTo(0, 6);
    // The raw probability survives so the correction stays auditable.
    expect(ben.frames[0]?.raw).toBe(0.27);
  });

  it('skips correction below the confidence threshold', () => {
    const participants = [
      { participantId: 'p-ana', frames: frames([0.9]) },
      { participantId: 'p-ben', frames: frames([0.27]) },
    ];
    const corrected = applyBleedCorrection(participants, {
      'p-ben': {
        bleed: { 'p-ana': 0.3 },
        confidence: BLEED_CORRECTION_CONFIDENCE_THRESHOLD - 0.01,
      },
    });

    const ben = corrected.find((entry) => entry.participantId === 'p-ben')!;
    // Subtracting a guess is how a quiet speaker gets cut out of their own shot.
    expect(ben.bleedCorrectionApplied).toBe(false);
    expect(ben.frames[0]?.corrected).toBe(0.27);
  });

  it('never produces a probability outside 0..1', () => {
    const participants = [
      { participantId: 'p-ana', frames: frames([1]) },
      { participantId: 'p-ben', frames: frames([0.1]) },
    ];
    const corrected = applyBleedCorrection(participants, {
      'p-ben': { bleed: { 'p-ana': 0.9 }, confidence: 1 },
    });

    expect(corrected[1]?.frames[0]?.corrected).toBe(0);
  });
});

describe('speech ranges', () => {
  it('opens on the high threshold and closes on the low one', () => {
    const ranges = toSpeechRanges(
      {
        participantId: 'p-ana',
        // Dips to 0.4 mid-word, which must not end the range.
        frames: frames([0.1, 0.8, 0.4, 0.8, 0.1]),
        bleed: {},
        bleedConfidence: 1,
        bleedCorrectionApplied: false,
      },
      { windowMs: WINDOW_MS },
    );

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ startMs: 100, endMs: 400 });
  });

  it('drops speech shorter than the policy minimum', () => {
    const ranges = toSpeechRanges(
      {
        participantId: 'p-ana',
        frames: frames([0.1, 0.9, 0.1, 0.1]),
        bleed: {},
        bleedConfidence: 1,
        bleedCorrectionApplied: false,
      },
      { windowMs: WINDOW_MS, minSpeechMs: 500 },
    );

    expect(ranges).toEqual([]);
  });

  it('closes an open range at the end of the recording', () => {
    const ranges = toSpeechRanges(
      {
        participantId: 'p-ana',
        frames: frames([0.9, 0.9]),
        bleed: {},
        bleedConfidence: 1,
        bleedCorrectionApplied: false,
      },
      { windowMs: WINDOW_MS },
    );

    expect(ranges[0]).toMatchObject({ startMs: 0, endMs: 200 });
  });

  it('reads corrected probabilities, not raw ones', () => {
    const ranges = toSpeechRanges(
      {
        participantId: 'p-ben',
        frames: [
          { atReferenceMs: 0, raw: 0.9, corrected: 0.05 },
          { atReferenceMs: 100, raw: 0.9, corrected: 0.05 },
        ],
        bleed: { 'p-ana': 0.9 },
        bleedConfidence: 1,
        bleedCorrectionApplied: true,
      },
      { windowMs: WINDOW_MS },
    );

    // Raw would have shown Ben speaking; corrected shows it was Ana's voice.
    expect(ranges).toEqual([]);
  });
});
