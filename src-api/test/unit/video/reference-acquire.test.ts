import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import {
  acquireReference,
  ReferenceAcquireError,
  type ReferenceDownloader,
  type ReferenceSpawnFn,
} from '@/shared/video/reference/acquire';
import { readReferenceEnvelope } from '@/shared/video/reference/store';
import { classifyYtDlpError } from '@/shared/video/source/ytdlp';
import { createProject, getProject } from '@/shared/video/store';
import type { ReferenceProbe } from '@/shared/video/types';

vi.mock('@/shared/video/source/ytdlp', async (orig) => {
  const actual = await orig<typeof import('@/shared/video/source/ytdlp')>();
  return {
    ...actual,
    validateYtDlpUrl: vi.fn().mockResolvedValue(undefined),
  };
});

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/video/reference/still-8s.mp4', import.meta.url),
);

async function stubDownloader(
  info?: Record<string, unknown>,
): Promise<ReferenceDownloader> {
  return {
    async fetch({ destinationDir }) {
      await fs.mkdir(destinationDir, { recursive: true });
      await fs.copyFile(FIXTURE, path.join(destinationDir, 'clip.mp4'));
      if (info) {
        await fs.writeFile(
          path.join(destinationDir, 'clip.info.json'),
          `${JSON.stringify(info)}\n`,
        );
      }
    },
  };
}

describe('acquireReference', () => {
  let workDir: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'video-reference-acquire-'),
    );
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('rejects intake without study acknowledgement', async () => {
    const project = await createProject({
      name: 'Reference study',
      template: 'explainer',
    });
    await expect(
      acquireReference(project.id, {
        origin: 'upload',
        studyAcknowledged: false,
        fileBytes: await fs.readFile(FIXTURE),
        fileName: 'still-8s.mp4',
      }),
    ).rejects.toMatchObject({
      name: 'ReferenceAcquireError',
      code: 'study-required',
    });
    expect((await getProject(project.id)).videoReferences ?? []).toEqual([]);
    expect((await getProject(project.id)).assets).toEqual([]);
  });

  it('probes upload, workspace-path, and stubbed link origins without creating assets', async () => {
    const project = await createProject({
      name: 'Reference origins',
      template: 'explainer',
    });

    const uploaded = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
      label: 'Upload still',
    });
    const workspace = await acquireReference(project.id, {
      origin: 'workspace-path',
      studyAcknowledged: true,
      filePath: FIXTURE,
      label: 'Workspace still',
    });
    const linked = await acquireReference(project.id, {
      origin: 'link',
      studyAcknowledged: true,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      label: 'Link still',
      downloader: await stubDownloader({ extractor: 'youtube' }),
    });

    for (const result of [uploaded, workspace, linked]) {
      expect(result.reference.durationMs).toBeGreaterThan(0);
      expect(result.reference.rights.studyAcknowledged).toBe(true);
      expect(result.reference.rights.reuseAcknowledged).toBe(false);
      expect(result.reference.mediaPath).toMatch(
        /^references\/ref-[0-9a-f]+\/media\//,
      );
      expect(result.project.assets).toEqual([]);
      const probe = await readReferenceEnvelope<ReferenceProbe>(
        project.id,
        result.reference.id,
        'probe',
      );
      expect(probe?.data.width).toBeGreaterThan(0);
    }

    expect(linked.reference.extractor).toBe('youtube');
    expect(linked.reference.sourceUrl).toContain('youtube.com');
    const stored = await getProject(project.id);
    expect(stored.videoReferences).toHaveLength(3);
    expect(stored.assets).toEqual([]);
  });

  it('does not change the probe fingerprint when only the label changes', async () => {
    const project = await createProject({
      name: 'Reference fingerprint',
      template: 'explainer',
    });
    const first = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
      label: 'First name',
    });
    const second = await acquireReference(project.id, {
      origin: 'upload',
      studyAcknowledged: true,
      fileBytes: await fs.readFile(FIXTURE),
      fileName: 'still-8s.mp4',
      label: 'Second name',
    });
    const firstProbe = await readReferenceEnvelope<ReferenceProbe>(
      project.id,
      first.reference.id,
      'probe',
    );
    const secondProbe = await readReferenceEnvelope<ReferenceProbe>(
      project.id,
      second.reference.id,
      'probe',
    );
    expect(firstProbe?.sourceFingerprint).toBe(secondProbe?.sourceFingerprint);
    expect(first.reference.label).not.toBe(second.reference.label);
  });

  it('never leaks classified yt-dlp stderr', async () => {
    const project = await createProject({
      name: 'Reference ytdlp',
      template: 'explainer',
    });
    const secret =
      'ERROR: HTTP Error 403: Forbidden cookie=SECRET_TOKEN_abc123';
    const classified = classifyYtDlpError(secret, 1);
    const spawnFn = (() => {
      const child = new EventEmitter();
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      Object.assign(child, {
        stdout,
        stderr,
        kill: vi.fn(),
      });
      queueMicrotask(() => {
        stderr.emit('data', Buffer.from(secret));
        child.emit('close', 1);
      });
      return child;
    }) as ReferenceSpawnFn;

    await expect(
      acquireReference(project.id, {
        origin: 'link',
        studyAcknowledged: true,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        spawnFn,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(ReferenceAcquireError);
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toBe(classified.message);
      expect(message).not.toContain('SECRET_TOKEN_abc123');
      expect(message).not.toContain('cookie=');
      return true;
    });
  });

  it('blocks YouTube intake when the plugin capability is denied', async () => {
    const project = await createProject({
      name: 'Reference youtube gate',
      template: 'explainer',
    });
    await expect(
      acquireReference(project.id, {
        origin: 'link',
        studyAcknowledged: true,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        youtubeCapabilityGranted: false,
        downloader: await stubDownloader(),
      }),
    ).rejects.toMatchObject({ code: 'youtube-capability' });
    expect((await getProject(project.id)).videoReferences ?? []).toEqual([]);
  });

  it('rejects live streams and playlists', async () => {
    const project = await createProject({
      name: 'Reference live',
      template: 'explainer',
    });
    await expect(
      acquireReference(project.id, {
        origin: 'link',
        studyAcknowledged: true,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        downloader: await stubDownloader({
          extractor: 'youtube',
          is_live: true,
        }),
      }),
    ).rejects.toMatchObject({ code: 'live' });
    await expect(
      acquireReference(project.id, {
        origin: 'link',
        studyAcknowledged: true,
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        downloader: await stubDownloader({
          extractor: 'youtube',
          playlist_count: 12,
        }),
      }),
    ).rejects.toMatchObject({ code: 'playlist' });
  });
});
