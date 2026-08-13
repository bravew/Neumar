import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  openRenderedOutput,
  renderedOutputUrl,
} from '@/components/video/preview/previewOutputActions';
import type { VideoProject, VideoRenderOutput } from '@/shared/types/video';

describe('preview output actions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens rendered output through the project stream route in browser mode', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    const project = videoProject({
      render: {
        status: 'done',
        outputPath: 'videos/project-1/output/out.mp4',
        updatedAt: '2026-06-15T02:23:13.707Z',
      },
    });
    const output = videoOutput({
      aspectRatio: '16:9',
      path: 'videos/project-1/output/out.mp4',
    });

    await openRenderedOutput(project, output);

    expect(openSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:5126/video/projects/project-1/output?aspectRatio=16%3A9&v=2026-06-15T02%3A23%3A13.707Z',
      '_blank',
      'noopener,noreferrer',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does nothing when no rendered output exists', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await openRenderedOutput(videoProject(), undefined);

    expect(openSpy).not.toHaveBeenCalled();
  });

  it('builds output URLs without optional params when no output is selected', () => {
    expect(renderedOutputUrl(videoProject())).toBe(
      'http://127.0.0.1:5126/video/projects/project-1/output',
    );
  });
});

function videoProject(overrides: Partial<VideoProject> = {}): VideoProject {
  const base: VideoProject = {
    id: 'project-1',
    name: 'Preview output test',
    template: 'slideshow',
    prompt: 'Preview output test',
    assets: [],
    sources: [],
    linkedSources: [],
    sourceAnalyses: [],
    cutPlans: [],
    scenes: [],
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
  };
  return { ...base, ...overrides, prompt: overrides.prompt ?? base.prompt };
}

function videoOutput(
  overrides: Partial<VideoRenderOutput> = {},
): VideoRenderOutput {
  return {
    aspectRatio: '16:9',
    path: 'videos/project-1/output/out.mp4',
    durationSec: 10,
    fileSize: 1024,
    codec: 'h264',
    ...overrides,
  };
}
