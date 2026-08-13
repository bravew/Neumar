import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEditorHandoffModel } from '@/shared/video/editor-handoff/build-model';
import { evaluateHandoffConformance } from '@/shared/video/editor-handoff/conformance';

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
