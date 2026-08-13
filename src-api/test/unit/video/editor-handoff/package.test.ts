import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEditorHandoffPackage } from '@/shared/video/editor-handoff/package';

import { createEditorHandoffFixtureProject } from './fixture-project';

let workDir: string;

describe('editor handoff package', () => {
  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'editor-handoff-pkg-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('writes sidecars, interchange files, copied media, and a zip package', async () => {
    const project = await createEditorHandoffFixtureProject(workDir);
    const result = await createEditorHandoffPackage(project, {
      jobId: 'job-test',
      targets: ['final-cut-pro', 'premiere-pro', 'edl'],
      outputRoot: path.join(workDir, 'package'),
      workspaceRoot: workDir,
    });

    const manifest = JSON.parse(
      await fs.readFile(result.manifestPath, 'utf8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      schema: 'neuma.video.editor-handoff.manifest.v1',
      projectId: 'handoff-fixture',
      mediaMode: 'copy',
    });
    expect(manifest.mediaRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'asset-video-alpha',
          collectionId: 'scene:intro',
          collectionLabel: 'Intro variants',
          provenance: expect.objectContaining({
            jobId: 'job-alpha',
            acceptedOpId: 'hist-approved-silence',
            references: [{ kind: 'asset', id: 'asset-overlay' }],
          }),
        }),
      ]),
    );
    expect(await exists(result.packagePath)).toBe(true);
    expect(
      await exists(
        path.join(result.packageDir, 'media', 'asset-video-alpha.mp4'),
      ),
    ).toBe(true);
    expect(
      await exists(path.join(result.packageDir, 'captions', 'captions.srt')),
    ).toBe(true);
    expect(
      await exists(
        path.join(result.packageDir, 'interchange', 'timeline.otio'),
      ),
    ).toBe(true);
    const otio = JSON.parse(
      await fs.readFile(
        path.join(result.packageDir, 'interchange', 'timeline.otio'),
        'utf8',
      ),
    ) as {
      tracks?: {
        children?: Array<{
          children?: Array<{ metadata?: { keyframes?: unknown } }>;
        }>;
      };
    };
    expect(
      otio.tracks?.children
        ?.flatMap((track) => track.children ?? [])
        .some((clip) => Array.isArray(clip.metadata?.keyframes)),
    ).toBe(true);

    const fcpxml = await fs.readFile(
      path.join(result.packageDir, 'interchange', 'timeline.fcpxml'),
      'utf8',
    );
    expect(fcpxml).toContain('Intro &amp; &lt;Alpha&gt;');
    expect(fcpxml).toContain('Caption &amp; &lt;one&gt; &quot;quoted&quot;');

    const premiereXml = await fs.readFile(
      path.join(result.packageDir, 'interchange', 'timeline-premiere.xml'),
      'utf8',
    );
    expect(premiereXml).toContain('Beta &quot;quoted&quot;');

    const edl = await fs.readFile(
      path.join(result.packageDir, 'interchange', 'timeline.edl'),
      'utf8',
    );
    expect(edl).toContain('TITLE: Editor handoff & "XML" <fixture>');
    expect(result.conformance.summary.errorCount).toBe(1);
  });
});

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
