import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { videoRoutes } from '@/app/api/video';

// Slice K — HTML template/variable selection routes + flags snapshot.

let workDirRoot: string;
let originalWorkDir: string | undefined;
const projectId = 'html-sel-test';

beforeAll(() => {
  workDirRoot = mkdtempSync(path.join(tmpdir(), 'html-sel-'));
  originalWorkDir = process.env.NEUMA_VIDEO_WORKDIR;
  process.env.NEUMA_VIDEO_WORKDIR = workDirRoot;
});
afterAll(() => {
  rmSync(workDirRoot, { recursive: true, force: true });
  if (originalWorkDir === undefined) delete process.env.NEUMA_VIDEO_WORKDIR;
  else process.env.NEUMA_VIDEO_WORKDIR = originalWorkDir;
});

describe('GET /video/flags', () => {
  it('returns all flags on by default', async () => {
    const res = await videoRoutes.request('/flags');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { flags: Record<string, boolean> };
    expect(json.flags['video.engine.html']).toBe(true);
    expect(json.flags['video.contentGraph']).toBe(true);
  });
});

describe('HTML template gallery preview routes', () => {
  it('returns poster preview metadata for bundled templates', async () => {
    const res = await videoRoutes.request('/html-gallery');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      templates: Array<{
        id: string;
        preview?: { mode: string; posterUrl: string | null; aspect: string };
      }>;
    };
    const template = json.templates.find(
      (item) => item.id === 'frame-bold-poster',
    );
    expect(template?.preview).toMatchObject({
      mode: 'poster',
      posterUrl: '/video/html-gallery/frame-bold-poster/asset?path=preview.png',
      aspect: '16:9',
    });
  });

  it('serves poster assets through a contained template asset endpoint', async () => {
    const res = await videoRoutes.request(
      '/html-gallery/frame-bold-poster/asset?path=preview.png',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  });

  it('rejects template asset paths that escape the template directory', async () => {
    const res = await videoRoutes.request(
      '/html-gallery/frame-bold-poster/asset?path=../frame-clean-title/template.video.yaml',
    );
    expect(res.status).toBe(404);
  });

  it('does not serve non-preview files through the poster asset route', async () => {
    const res = await videoRoutes.request(
      '/html-gallery/frame-bold-poster/asset?path=template.video.yaml',
    );
    expect(res.status).toBe(404);
  });
});

describe('HTML selection routes', () => {
  it('defaults to empty selection', async () => {
    const res = await videoRoutes.request(
      `/projects/${projectId}/html-selection`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ templateId: null, variables: {} });
  });

  it('persists and reads back template id + variables', async () => {
    const put = await videoRoutes.request(
      `/projects/${projectId}/html-selection`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: 'quote-card',
          variables: { title: 'Hi', count: 3 },
        }),
      },
    );
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({
      templateId: 'quote-card',
      variables: { title: 'Hi', count: 3 },
    });

    const get = await videoRoutes.request(
      `/projects/${projectId}/html-selection`,
    );
    expect(await get.json()).toEqual({
      templateId: 'quote-card',
      variables: { title: 'Hi', count: 3 },
    });
  });

  it('updates variables without dropping the template', async () => {
    await videoRoutes.request(`/projects/${projectId}/html-selection`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variables: { title: 'Changed' } }),
    });
    const get = await videoRoutes.request(
      `/projects/${projectId}/html-selection`,
    );
    expect(await get.json()).toEqual({
      templateId: 'quote-card',
      variables: { title: 'Changed' },
    });
  });

  it('rejects an invalid body', async () => {
    const res = await videoRoutes.request(
      `/projects/${projectId}/html-selection`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 123 }),
      },
    );
    expect(res.status).toBe(400);
  });
});
