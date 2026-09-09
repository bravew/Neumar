import { describe, expect, it } from 'vitest';

import type { SpeechRange } from '@/shared/video/multicam/activity';
import {
  parseMulticamManifest,
  type MulticamManifest,
} from '@/shared/video/multicam/manifest';
import { buildShotPlan } from '@/shared/video/multicam/shot-plan';

function manifest(policy: Record<string, unknown> = {}): MulticamManifest {
  return parseMulticamManifest({
    schema: 'neuma.video.multicam-manifest.v1',
    id: 'group-1',
    label: 'Panel',
    referenceCameraId: 'cam-wide',
    participants: [
      { id: 'p-ana', name: 'Ana' },
      { id: 'p-ben', name: 'Ben' },
    ],
    cameras: [
      { id: 'cam-wide', label: 'Wide', type: 'wide', assetId: 'asset-wide' },
      {
        id: 'cam-ana',
        label: 'Ana',
        type: 'close',
        assetId: 'asset-ana',
        participantId: 'p-ana',
        isolatedAudioAssetId: 'mic-ana',
      },
      {
        id: 'cam-ben',
        label: 'Ben',
        type: 'close',
        assetId: 'asset-ben',
        participantId: 'p-ben',
        isolatedAudioAssetId: 'mic-ben',
      },
    ],
    // cutLeadMs 0 keeps these fixtures readable; its own effect is tested below.
    policy: { cutLeadMs: 0, minShotMs: 1000, maxShotMs: 20_000, ...policy },
  });
}

function plan(
  speechRanges: SpeechRange[],
  durationMs: number,
  policy: Record<string, unknown> = {},
) {
  return buildShotPlan({
    manifest: manifest(policy),
    speechRanges,
    durationMs,
    sourceFingerprint: 'fp',
  });
}

function speech(
  participantId: string,
  startMs: number,
  endMs: number,
  meanProbability = 0.9,
): SpeechRange {
  return { participantId, startMs, endMs, meanProbability };
}

describe('shot planner', () => {
  it('cuts to the speaker and back to the wide during silence', () => {
    const result = plan(
      [speech('p-ana', 2000, 6000), speech('p-ben', 8000, 12_000)],
      14_000,
    );

    expect(
      result.shots.map((shot) => [shot.cameraId, shot.startMs, shot.endMs]),
    ).toEqual([
      ['cam-wide', 0, 2000],
      ['cam-ana', 2000, 6000],
      ['cam-wide', 6000, 8000],
      ['cam-ben', 8000, 12_000],
      ['cam-wide', 12_000, 14_000],
    ]);
    expect(result.shots[0]?.reason).toBe('silence');
    expect(result.shots[1]?.reason).toBe('speaker');
  });

  it('is deterministic across runs and input order', () => {
    const ranges = [speech('p-ana', 2000, 6000), speech('p-ben', 8000, 12_000)];
    const forward = plan(ranges, 14_000);
    const reversed = plan([...ranges].reverse(), 14_000);

    expect(reversed.shots).toEqual(forward.shots);
    expect(plan(ranges, 14_000).shots).toEqual(forward.shots);
  });

  it('holds the wide when speakers overlap and the policy says so', () => {
    const result = plan(
      [speech('p-ana', 2000, 8000), speech('p-ben', 4000, 6000)],
      10_000,
      { overlapPolicy: 'wide' },
    );

    const overlapShot = result.shots.find(
      (shot) => shot.startMs === 4000 && shot.endMs === 6000,
    );
    expect(overlapShot).toMatchObject({
      cameraId: 'cam-wide',
      reason: 'overlap-wide',
    });
  });

  it('follows the loudest speaker when the policy says so', () => {
    const result = plan(
      [speech('p-ana', 2000, 8000, 0.5), speech('p-ben', 4000, 6000, 0.95)],
      10_000,
      { overlapPolicy: 'loudest' },
    );

    expect(
      result.shots.find((shot) => shot.startMs === 4000 && shot.endMs === 6000),
    ).toMatchObject({ cameraId: 'cam-ben', reason: 'overlap-loudest' });
  });

  it('breaks an overlap tie by participant id, not by input order', () => {
    const result = plan(
      [speech('p-ben', 0, 4000, 0.8), speech('p-ana', 0, 4000, 0.8)],
      4000,
      { overlapPolicy: 'loudest' },
    );

    expect(result.shots[0]?.cameraId).toBe('cam-ana');
  });

  it('absorbs a shot shorter than the policy minimum into its neighbour', () => {
    const result = plan(
      [speech('p-ana', 1000, 5000), speech('p-ben', 5000, 5400)],
      6000,
      { minShotMs: 1000 },
    );

    // Ben's 400ms would have been a flash cut; it is absorbed, and the
    // timeline stays gapless.
    expect(
      result.shots.every((shot) => shot.endMs - shot.startMs >= 1000),
    ).toBe(true);
    expect(result.shots.at(-1)?.endMs).toBe(6000);
  });

  it('splits a shot longer than the policy maximum', () => {
    const result = plan([speech('p-ana', 0, 30_000)], 30_000, {
      maxShotMs: 10_000,
      minShotMs: 1000,
    });

    expect(
      result.shots.filter((shot) => shot.reason === 'max-shot').length,
    ).toBe(2);
    expect(
      result.shots.every((shot) => shot.endMs - shot.startMs <= 10_000),
    ).toBe(true);
  });

  it('leaves no gaps or overlaps between shots', () => {
    const result = plan(
      [speech('p-ana', 1200, 4300), speech('p-ben', 6100, 9900)],
      12_000,
    );

    expect(result.shots[0]?.startMs).toBe(0);
    expect(result.shots.at(-1)?.endMs).toBe(12_000);
    for (let index = 1; index < result.shots.length; index += 1) {
      expect(result.shots[index]!.startMs).toBe(result.shots[index - 1]!.endMs);
    }
  });

  it('lands the cut ahead of the speaker when cutLeadMs is negative', () => {
    const result = plan([speech('p-ana', 3000, 7000)], 9000, {
      cutLeadMs: -200,
      minShotMs: 500,
    });

    expect(
      result.shots.find((shot) => shot.cameraId === 'cam-ana')?.startMs,
    ).toBe(2800);
  });

  it('falls back to the wide for a speaker with no close angle', () => {
    const result = plan([speech('p-zoe', 1000, 5000)], 6000);

    expect(result.shots).toHaveLength(1);
    expect(result.shots[0]?.cameraId).toBe('cam-wide');
  });

  it('keeps the more specific reason when two wide shots merge', () => {
    // Silence, then crosstalk, then silence — all on the wide. Reporting the
    // whole stretch as "silence" would tell a reviewer nobody was talking
    // through a passage where two people were talking over each other.
    const result = plan(
      [speech('p-ana', 4000, 6000), speech('p-ben', 4000, 6000)],
      10_000,
      { overlapPolicy: 'wide' },
    );

    expect(result.shots).toHaveLength(1);
    expect(result.shots[0]).toMatchObject({
      cameraId: 'cam-wide',
      reason: 'overlap-wide',
    });
  });

  it('carries the policy and fingerprint on the artifact', () => {
    const result = plan([speech('p-ana', 0, 4000)], 4000);

    expect(result.sourceFingerprint).toBe('fp');
    expect(result.policy.minShotMs).toBe(1000);
    expect(result.schema).toBe('neuma.video.multicam-shot-plan.v1');
  });

  it('proposes shots without touching a timeline', () => {
    const result = plan([speech('p-ana', 0, 4000)], 4000) as Record<
      string,
      unknown
    >;

    // Phase 5 is read-only with respect to the timeline; applying is Phase 6.
    expect(result).not.toHaveProperty('ops');
    expect(result).not.toHaveProperty('appliedAt');
  });
});
