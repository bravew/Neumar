import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SavePluginCandidateDialog } from '@/components/video/SavePluginCandidateDialog';
import type { VideoProject } from '@/shared/types/video';

import { renderWithProviders } from '../helpers/render-with-providers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SavePluginCandidateDialog', () => {
  it('authors and saves an active candidate from a completed render', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/video/plugins/candidates?')) {
        return jsonResponse({ candidates: [candidate()] });
      }
      if (url.includes('/video/plugins/candidates/candidate-1/save')) {
        return jsonResponse({
          candidate: { ...candidate(), status: 'saved' },
          plugin: {
            id: 'project/reusable-launch-flow',
            name: 'reusable-launch-flow',
            version: '0.1.0',
            trustTier: 'saved',
            manifestDigest: 'saved-digest',
          },
          pluginDir: '/tmp/work/.plugins/reusable-launch-flow',
          manifestPath:
            '/tmp/work/.plugins/reusable-launch-flow/.claude-plugin/plugin.json',
          videoManifestPath:
            '/tmp/work/.plugins/reusable-launch-flow/video-plugin.json',
        });
      }
      return jsonResponse({ error: 'unexpected request' }, false);
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    renderWithProviders(<SavePluginCandidateDialog project={project()} />);

    fireEvent.click(
      await screen.findByRole('button', {
        name: /save this flow as a plugin/i,
      }),
    );
    fireEvent.change(screen.getByLabelText('Plugin name'), {
      target: { value: 'Reusable Launch Flow' },
    });
    fireEvent.change(screen.getByLabelText('Summary'), {
      target: { value: 'Reusable launch visuals.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save plugin' }));

    expect(
      await screen.findByText(
        'Saved to /tmp/work/.plugins/reusable-launch-flow',
      ),
    ).toBeInTheDocument();
    const saveCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/video/plugins/candidates/candidate-1/save'),
    );
    expect(saveCall).toBeDefined();
    const [, saveInit] = saveCall as unknown as [string, RequestInit];
    expect(JSON.parse(String(saveInit.body))).toEqual({
      title: 'Reusable Launch Flow',
      description: 'Reusable launch visuals.',
      scope: 'project',
    });
  });
});

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

function project(): VideoProject {
  return {
    id: 'project-1',
    name: 'Project',
    template: 'custom',
    prompt: '',
    assets: [],
    render: { status: 'done' },
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}

function candidate() {
  return {
    id: 'candidate-1',
    domain: 'video',
    projectId: 'project-1',
    title: 'Reusable Flow',
    description: 'Detected reusable flow.',
    confidence: 0.82,
    status: 'active',
    manifestDigest: 'source-digest',
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt: '2026-06-16T00:00:00.000Z',
  };
}
