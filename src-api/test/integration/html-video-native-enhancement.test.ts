import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ContentGraph } from '@neumar/video-ir';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

import { compileContentGraphToStoryboard } from '@/shared/video/content-graph/compile';
import { writeContentGraph } from '@/shared/video/content-graph/persistence';
import { getProject, writeProject } from '@/shared/video/store';
import type { GalleryTemplate } from '@/shared/video/templates/gallery-loader';
import type { VideoProject } from '@/shared/video/types';

const projectId = 'native-enhancement-test';

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-enhancement-'));
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('HTML video native frame enhancement route', () => {
  it('enables and disables a native Remotion override for a data frame', async () => {
    const graph: ContentGraph = {
      schemaVersion: 1,
      intent: 'data-viz',
      nodes: [
        {
          id: 'metrics',
          kind: 'data',
          data: { revenue: 12.4, signups: 18_000 },
          durationSec: 4,
        },
      ],
      edges: [],
    };
    await writeContentGraph(projectId, graph);
    const compiled = compileContentGraphToStoryboard(graph, {
      template: htmlTemplateFixture(),
    });
    await writeProject({
      id: projectId,
      name: 'Native enhancement test',
      template: 'custom',
      prompt: '',
      assets: [],
      storyboard: compiled.storyboard,
      createdAt: '2026-06-09T00:00:00.000Z',
      updatedAt: '2026-06-09T00:00:00.000Z',
    } satisfies VideoProject);

    const enabled = await videoRoutes.request(
      `/projects/${projectId}/content-graph/frames/metrics/native-enhancement`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      },
    );

    expect(enabled.status).toBe(200);
    const enabledProject = await getProject(projectId);
    expect(
      enabledProject.storyboard?.scenes[0]?.htmlFrameSeed?.renderOverride,
    ).toEqual({
      mode: 'native',
      templateId: 'frame-data-rollup',
      engine: 'remotion',
    });

    const disabled = await videoRoutes.request(
      `/projects/${projectId}/content-graph/frames/metrics/native-enhancement`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      },
    );

    expect(disabled.status).toBe(200);
    const disabledProject = await getProject(projectId);
    expect(
      disabledProject.storyboard?.scenes[0]?.htmlFrameSeed?.renderOverride,
    ).toBeUndefined();
  });
});

function htmlTemplateFixture(): GalleryTemplate {
  return {
    id: 'frame-data-bars',
    rootKind: 'branding',
    rootDir: workDir,
    metadataPath: path.join(workDir, 'frame-data-bars', 'template.video.yaml'),
    warnings: [],
    metadata: {
      spec_version: 1 as const,
      id: 'frame-data-bars',
      name: 'Data Bars',
      engine: 'html',
      source_entry: 'source/index.html',
      category: 'data-viz',
      tags: [],
      output: {
        formats: ['mp4'],
        default_format: 'mp4',
        resolution: {
          default: { width: 640, height: 360 },
          supported_aspects: ['16:9'],
        },
        fps: { default: 30, supported: [30] },
        duration: { type: 'variable', min_sec: 1, max_sec: 10 },
        alpha: false,
        audio: { supported: false },
      },
      inputs: { schema: { type: 'object' } },
      license: {
        spdx: 'Apache-2.0',
        attribution_required: false,
        redistribution_allowed: true,
        commercial_use: true,
      },
      version: '0.1.0',
    },
  };
}
