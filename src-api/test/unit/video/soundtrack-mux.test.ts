import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { collectSoundtrackAudioTracks } from '@/shared/video/pipeline';
import type { ProjectSoundtrack } from '@/shared/video/soundtrack';
import type { MediaItem, VideoProject } from '@/shared/video/types';

// Phase 5 mux — the project soundtrack (music + narration) is folded into the
// same ffmpeg audio mix as the timeline audio. These tests pin the dB→volume
// ducking, the fade-out default, and the missing-asset skip behaviour.

let root: string;

function audioAsset(id: string, file: string): MediaItem {
  return { id, kind: 'audio', source: 'upload', path: file } as MediaItem;
}

function project(
  soundtrack: ProjectSoundtrack | undefined,
  assets: MediaItem[],
): VideoProject {
  return { soundtrack, assets } as unknown as VideoProject;
}

// dbToVolume mirrors pipeline.ts: clamp(10^(db/20), 0, 2).
const vol = (db: number) => Math.max(0, Math.min(2, 10 ** (db / 20)));

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'soundtrack-mux-'));
  writeFileSync(path.join(root, 'music.mp3'), 'x');
  writeFileSync(path.join(root, 'narration.mp3'), 'x');
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('collectSoundtrackAudioTracks', () => {
  it('returns nothing when the project has no soundtrack', () => {
    expect(
      collectSoundtrackAudioTracks(project(undefined, []), root, 30),
    ).toEqual([]);
  });

  it('ducks music to -18 dB by default and applies the default fade-out', () => {
    const tracks = collectSoundtrackAudioTracks(
      project({ musicAssetId: 'm' }, [audioAsset('m', 'music.mp3')]),
      root,
      30,
    );
    expect(tracks).toHaveLength(1);
    const music = tracks[0];
    expect(music.role).toBe('music');
    expect(music.volume).toBeCloseTo(vol(-18), 5);
    expect(music.fadeInMs).toBe(0);
    // default fade-out = min(1.5, dur/3) → 1.5s at 30s.
    expect(music.fadeOutMs).toBe(1500);
  });

  it('honours explicit gains and fades, narration at 0 dB with no fade', () => {
    const soundtrack: ProjectSoundtrack = {
      musicAssetId: 'm',
      narrationAssetId: 'n',
      musicVolumeDb: -10,
      narrationVolumeDb: -2,
      fadeInSec: 0.5,
      fadeOutSec: 2,
    };
    const tracks = collectSoundtrackAudioTracks(
      soundtrackProject(soundtrack),
      root,
      30,
    );
    const music = tracks.find((t) => t.role === 'music');
    const narration = tracks.find((t) => t.role === 'narration');
    if (!music || !narration) {
      throw new Error('expected both music and narration tracks');
    }
    expect(music.volume).toBeCloseTo(vol(-10), 5);
    expect(music.fadeInMs).toBe(500);
    expect(music.fadeOutMs).toBe(2000);
    expect(narration.volume).toBeCloseTo(vol(-2), 5);
    expect(narration.fadeInMs).toBeUndefined();
    expect(narration.fadeOutMs).toBeUndefined();
  });

  it('skips a soundtrack asset that is missing or not audio', () => {
    const tracks = collectSoundtrackAudioTracks(
      project({ musicAssetId: 'ghost', narrationAssetId: 'n' }, [
        audioAsset('n', 'narration.mp3'),
        {
          id: 'ghost',
          kind: 'video',
          source: 'upload',
          path: 'clip.mp4',
        } as MediaItem,
      ]),
      root,
      30,
    );
    expect(tracks.map((t) => t.role)).toEqual(['narration']);
  });

  it('skips an audio asset whose backing file is absent on disk', () => {
    // The most common "missing" case: the asset record exists with
    // kind: 'audio' but the file was purged. validateInputFile throws; the
    // render must not abort.
    const tracks = collectSoundtrackAudioTracks(
      project({ musicAssetId: 'gone', narrationAssetId: 'n' }, [
        audioAsset('n', 'narration.mp3'),
        audioAsset('gone', 'deleted.mp3'),
      ]),
      root,
      30,
    );
    expect(tracks.map((t) => t.role)).toEqual(['narration']);
  });
});

function soundtrackProject(soundtrack: ProjectSoundtrack): VideoProject {
  return project(soundtrack, [
    audioAsset('m', 'music.mp3'),
    audioAsset('n', 'narration.mp3'),
  ]);
}
