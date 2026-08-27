import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSetting } from '@/shared/db/operations';
import { createBrollTools } from '@/shared/mcp/broll-server';
import {
  assertYtDlpArgsAllowed,
  importYoutubeBroll,
  type YoutubeBrollRunner,
} from '@/shared/video/plugins/atoms/broll/youtube';
import { buildYtDlpArgs } from '@/shared/video/source/ytdlp';
import { createProject, getProject } from '@/shared/video/store';

const YOUTUBE_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe('YouTube b-roll atom', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-youtube-broll-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
    setSetting('video.plugins', 'true');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('rejects imports when the network:youtube capability is absent', async () => {
    const project = await createProject({
      name: 'YouTube blocked',
      template: 'slideshow',
    });

    await expect(
      importYoutubeBroll(
        project.id,
        { url: YOUTUBE_URL, rightsAcknowledged: true },
        { capabilityGranted: false, runner: fakeRunner() },
      ),
    ).rejects.toThrow('network:youtube capability');
  });

  it('rejects imports until the user acknowledges rights', async () => {
    const project = await createProject({
      name: 'YouTube rights',
      template: 'slideshow',
    });

    await expect(
      importYoutubeBroll(
        project.id,
        { url: YOUTUBE_URL },
        {
          capabilityGranted: true,
          runner: fakeRunner(),
        },
      ),
    ).rejects.toThrow('rights acknowledgement');
  });

  it('rejects non-YouTube URLs even after generic URL validation passes', async () => {
    const project = await createProject({
      name: 'YouTube host',
      template: 'slideshow',
    });

    await expect(
      importYoutubeBroll(
        project.id,
        {
          url: 'https://example.com/watch?v=dQw4w9WgXcQ',
          rightsAcknowledged: true,
        },
        { capabilityGranted: true, runner: fakeRunner() },
      ),
    ).rejects.toThrow('youtube.com or youtu.be');
  });

  it('enforces the yt-dlp argument allowlist', async () => {
    const project = await createProject({
      name: 'YouTube args',
      template: 'slideshow',
    });

    expect(() =>
      assertYtDlpArgsAllowed(
        ['--ignore-config', '--exec', 'rm -rf /', YOUTUBE_URL],
        {
          projectId: project.id,
          sourceId: 'source-1',
          url: YOUTUBE_URL,
          format: 'mp4',
        },
      ),
    ).toThrow('allowlisted plan');
  });

  it('downloads into the project root, writes provenance, and persists project rights ack', async () => {
    const project = await createProject({
      name: 'YouTube success',
      template: 'slideshow',
    });
    const runner = fakeRunner();
    const now = () => new Date('2026-06-16T00:00:00.000Z');

    const result = await importYoutubeBroll(
      project.id,
      {
        url: YOUTUBE_URL,
        rightsAcknowledged: true,
        persistRightsAck: true,
        rightsNotes: 'User owns or licensed this source.',
      },
      { capabilityGranted: true, runner, now },
    );

    expect(runner.run).toHaveBeenCalledTimes(1);
    const [, runOptions] = runner.run.mock.calls[0]!;
    expect(runOptions.outputDir.startsWith(path.join(workDir, 'videos'))).toBe(
      true,
    );
    expect(result.asset).toMatchObject({
      kind: 'video',
      source: 'broll',
      provenance: {
        provider: 'youtube-unverified',
        hitId: 'demo-id',
        license: 'youtube-unverified',
        attributionRequired: true,
        commercialUse: false,
        sourceUrl: YOUTUBE_URL,
        sourceDisplayName: 'Demo reference',
        sourceFetchedAt: '2026-06-16T00:00:00.000Z',
      },
    });
    expect(result.source).toMatchObject({
      origin: 'yt-dlp',
      sourceUrl: YOUTUBE_URL,
      rights: {
        userConfirmed: true,
        notes: 'User owns or licensed this source.',
      },
    });
    await expect(getProject(project.id)).resolves.toMatchObject({
      assets: [expect.objectContaining({ id: result.asset.id })],
      sources: [expect.objectContaining({ id: result.source.id })],
      settings: {
        youtubeRightsAck: {
          accepted: true,
          acceptedAt: '2026-06-16T00:00:00.000Z',
          scope: 'project',
        },
      },
    });
  });

  it('allows a later import to reuse a persisted project rights ack', async () => {
    const project = await createProject({
      name: 'YouTube persisted ack',
      template: 'slideshow',
    });
    await importYoutubeBroll(
      project.id,
      {
        url: YOUTUBE_URL,
        rightsAcknowledged: true,
        persistRightsAck: true,
      },
      { capabilityGranted: true, runner: fakeRunner() },
    );

    await expect(
      importYoutubeBroll(
        project.id,
        { url: YOUTUBE_URL },
        {
          capabilityGranted: true,
          runner: fakeRunner(),
        },
      ),
    ).resolves.toMatchObject({
      asset: {
        provenance: {
          provider: 'youtube-unverified',
        },
      },
    });
  });

  it('keeps the full source when maxDurationSec is set', async () => {
    const project = await createProject({
      name: 'YouTube keep source',
      template: 'slideshow',
    });
    const runner = fakeRunner();

    const result = await importYoutubeBroll(
      project.id,
      {
        url: YOUTUBE_URL,
        rightsAcknowledged: true,
        maxDurationSec: 130,
      },
      { capabilityGranted: true, runner },
    );

    expect(runner.run).toHaveBeenCalledTimes(1);
    const [args] = runner.run.mock.calls[0]!;
    expect(args).not.toContain('--download-sections');
    expect(args).not.toContain('--match-filter');
    expect(result.asset.kind).toBe('video');
  });

  it('builds yt-dlp args that download the full video instead of skipping or sectioning', () => {
    const args = buildYtDlpArgs({
      projectId: 'proj',
      sourceId: 'source-1',
      url: YOUTUBE_URL,
      maxDurationSec: 130,
      format: 'mp4',
    });
    expect(args).not.toContain('--download-sections');
    expect(args).not.toContain('--match-filter');
  });

  it('exposes the MCP tool as mcp__broll__youtube', async () => {
    const project = await createProject({
      name: 'YouTube MCP',
      template: 'slideshow',
    });
    const tool = createBrollTools({
      projectId: project.id,
      youtubeCapabilityGranted: true,
      youtubeRunner: fakeRunner(),
      now: () => new Date('2026-06-16T00:00:00.000Z'),
    }).find((candidate) => candidate.name === 'youtube');
    if (!tool) throw new Error('Expected youtube tool');

    const result = await tool.handler(
      { url: YOUTUBE_URL, rightsAcknowledged: true },
      {},
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');

    expect(payload).toMatchObject({
      projectId: project.id,
      assetId: expect.any(String),
      sourceId: expect.any(String),
      provenance: {
        provider: 'youtube-unverified',
      },
    });
  });
});

function fakeRunner() {
  return {
    run: vi.fn<YoutubeBrollRunner['run']>(async (_args, options) => {
      await fs.mkdir(options.outputDir, { recursive: true });
      await fs.writeFile(path.join(options.outputDir, 'demo-id.mp4'), 'video');
      await fs.writeFile(
        path.join(options.outputDir, 'demo-id.info.json'),
        `${JSON.stringify({
          id: 'demo-id',
          title: 'Demo reference',
          uploader: 'Demo Channel',
          webpage_url: YOUTUBE_URL,
          duration: 3,
          license: 'youtube-unverified',
          thumbnail: 'https://i.ytimg.com/vi/demo/default.jpg',
        })}\n`,
      );
    }),
  };
}
