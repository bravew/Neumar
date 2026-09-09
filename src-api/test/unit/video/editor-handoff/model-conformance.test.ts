import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEditorHandoffModel } from '@/shared/video/editor-handoff/build-model';
import { evaluateHandoffConformance } from '@/shared/video/editor-handoff/conformance';
import { writeFcpxml } from '@/shared/video/editor-handoff/fcpxml';
import { writeOtioJson } from '@/shared/video/editor-handoff/otio-json';
import { writePremiereXml } from '@/shared/video/editor-handoff/premiere-xml';

import { createEditorHandoffFixtureProject } from './fixture-project';

let workDir: string;

describe('editor handoff model and conformance', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-handoff-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('builds a target-neutral model with media, handles, actions, and analysis', async () => {
    const project = await createEditorHandoffFixtureProject(workDir);
    const model = buildEditorHandoffModel(project);

    expect(model.tracks.map((track) => track.id)).toEqual([
      'track-video-main',
      'track-overlay',
      'track-audio-music',
      'track-caption',
    ]);
    expect(model.mediaRefs.map((ref) => ref.id)).toContain('asset-video-alpha');
    expect(
      model.derivatives.map((derivative) => derivative.kind).sort(),
    ).toEqual(['filmstrip', 'proxy', 'waveform']);
    expect(model.analysisArtifacts).toHaveLength(3);
    expect(model.actionBatches).toHaveLength(1);
    expect(model.actionBatches[0]?.recordId).toBe(
      'history:hist-approved-silence',
    );
    expect(model.tracks[0]?.clips[0]?.handles).toMatchObject({
      requestedBeforeMs: 2000,
      requestedAfterMs: 2000,
      availableBeforeMs: 2000,
      availableAfterMs: 2000,
    });
    expect(model.tracks[0]?.clips[1]?.keyframes).toEqual([
      {
        property: 'scale',
        keys: [
          { atMs: 0, value: 1, interp: 'linear' },
          { atMs: 4000, value: 1.08, interp: 'smooth' },
        ],
      },
    ]);
    const audioTrack = model.tracks.find(
      (track) => track.id === 'track-audio-music',
    );
    const audioClip = audioTrack?.clips.find(
      (clip) => clip.id === 'clip-audio-bed',
    );
    expect(audioTrack).toMatchObject({
      volumeDb: -12,
      duckUnderTrackId: 'track-audio-vo',
    });
    expect(audioClip).toMatchObject({
      muted: true,
      trackMuted: false,
      trackVolumeDb: -12,
      trackDuckUnderTrackId: 'track-audio-vo',
      gainDb: -6,
      fadeInMs: 250,
      fadeOutMs: 500,
      fadeInCurve: 'equal-power',
      fadeOutCurve: 'ease-in-out',
      audioTransitionToNext: {
        kind: 'crossfade',
        durationMs: 300,
        curve: 'equal-power',
      },
      provenance: expect.objectContaining({
        provider: 'stable-audio',
        prompt: 'Low pulse underscore for product reveal',
        generatedFor: { sceneId: 'scene-1', rangeMs: [0, 8000] },
      }),
    });
    expect(model.featureMap).toMatchObject({
      hasOverlays: true,
      hasUnsupportedEffects: true,
      hasSpeedChanges: true,
      hasStabilization: true,
      hasMotionTracking: true,
      hasUnsupportedBlendModes: true,
      hasColorGrades: true,
      hasKeyframeCurves: true,
      hasAudioGain: true,
      hasAudioFades: true,
      hasAudioMute: true,
      hasAudioTrackVolume: true,
      hasAudioTransitions: true,
      hasAudioDucking: true,
      hasGeneratedAudio: true,
      analysisArtifactCount: 3,
      approvedActionBatchCount: 1,
    });
  });

  it('uses stable action batch record ids across model builds', async () => {
    const project = await createEditorHandoffFixtureProject(workDir);
    const first = buildEditorHandoffModel(project);
    const second = buildEditorHandoffModel(project);

    expect(first.actionBatches.map((batch) => batch.recordId)).toEqual(
      second.actionBatches.map((batch) => batch.recordId),
    );
  });

  it('reports unverified targets and lossy features before export', async () => {
    const project = await createEditorHandoffFixtureProject(workDir);
    const report = evaluateHandoffConformance(
      buildEditorHandoffModel(project),
      ['premiere-pro', 'edl', 'capcut-fallback'],
    );

    expect(report.summary.warningCount).toBeGreaterThan(0);
    expect(report.summary.errorCount).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'target_unverified',
        'capcut_fallback_only',
        'missing_media',
        'flattened_effect',
        'overlay_flattened',
        'speed_change_degraded',
        'unsupported_blend_mode',
        'color_grade_degraded',
        'keyframe_curve_degraded',
        'audio_edit_metadata_degraded',
      ]),
    );
  });
});

describe('fractional timebase and output range survive interchange', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-handoff-ntsc-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  async function ntscProject() {
    const project = await createEditorHandoffFixtureProject(workDir);
    project.timeline = {
      ...project.timeline!,
      fps: 29.97,
      frameRate: { num: 30_000, den: 1001 },
      outputRange: { inFrame: 30, outFrameExclusive: 90 },
    };
    return project;
  }

  it('carries the exact rate and the range onto the model', async () => {
    const model = buildEditorHandoffModel(await ntscProject());

    expect(model.frameRate).toEqual({ num: 30_000, den: 1001 });
    expect(model.outputRange).toMatchObject({
      inFrame: 30,
      outFrameExclusive: 90,
    });
    // The numeric compatibility field is still there for older readers.
    expect(model.fps).toBe(29.97);
  });

  it('writes OTIO with the real rate, not a rounded 30', async () => {
    const otio = JSON.parse(
      writeOtioJson(buildEditorHandoffModel(await ntscProject())),
    );

    expect(otio.metadata.frameRate).toEqual({ num: 30_000, den: 1001 });
    const firstClip = otio.tracks.children[0].children[0];
    expect(firstClip.source_range.duration.rate).toBeCloseTo(29.97003, 5);
    expect(firstClip.source_range.duration.rate).not.toBe(30);
  });

  it('flags NTSC in Premiere XML instead of conforming as a true 30', async () => {
    const xml = writePremiereXml(buildEditorHandoffModel(await ntscProject()));

    expect(xml).toContain('<timebase>30</timebase><ntsc>TRUE</ntsc>');
  });

  it('emits an exact FCPXML frame duration', async () => {
    const xml = writeFcpxml(buildEditorHandoffModel(await ntscProject()));

    expect(xml).toContain('frameDuration="1001/30000s"');
  });

  it('keeps an integer project marked non-NTSC', async () => {
    const project = await createEditorHandoffFixtureProject(workDir);
    const xml = writePremiereXml(buildEditorHandoffModel(project));

    expect(xml).toContain('<timebase>30</timebase><ntsc>FALSE</ntsc>');
  });
});

describe('multicamera provenance survives handoff', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-handoff-mc-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  async function multicamProject() {
    const project = await createEditorHandoffFixtureProject(workDir);
    const track = project.timeline!.tracks[0]!;
    project.timeline = {
      ...project.timeline!,
      tracks: [
        {
          ...track,
          clips: track.clips.map((clip, index) =>
            index === 0
              ? {
                  ...clip,
                  params: {
                    ...(clip.params ?? {}),
                    multicamGroupId: 'group-1',
                    multicamCameraId: 'cam-ana',
                    multicamParticipantId: 'p-ana',
                    multicamPlanBatchId: 'multicam-abc123',
                    multicamReviewRevision: 3,
                    multicamReason: 'speaker',
                    multicamSourceStartMs: 2500,
                    multicamSyncOffsetMs: 500,
                    multicamSyncDriftPpm: 12,
                  },
                }
              : clip,
          ),
        } as (typeof project.timeline)['tracks'][number],
      ],
    };
    return project;
  }

  it('carries camera group, angle, source time, sync, and plan id onto the model', async () => {
    const model = buildEditorHandoffModel(await multicamProject());

    const clip = model.tracks[0]?.clips[0];
    expect(clip?.params).toMatchObject({
      multicamGroupId: 'group-1',
      multicamCameraId: 'cam-ana',
      multicamSourceStartMs: 2500,
      multicamSyncOffsetMs: 500,
      multicamPlanBatchId: 'multicam-abc123',
    });
  });

  it('writes the provenance into OTIO clip metadata', async () => {
    const otio = JSON.parse(
      writeOtioJson(buildEditorHandoffModel(await multicamProject())),
    );

    // An editor opening this file cold can still say which angle a clip is and
    // which reviewed plan produced it.
    const first = otio.tracks.children[0].children[0];
    expect(first.metadata.conformance).toMatchObject({
      multicamCameraId: 'cam-ana',
      multicamReason: 'speaker',
      multicamReviewRevision: 3,
    });
  });
});
