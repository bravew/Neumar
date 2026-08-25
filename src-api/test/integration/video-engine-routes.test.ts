import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { videoRoutes } from '@/app/api/video';

// Runtime-selection contract (P2-6) + the packaged-runtime setup surface the
// Phase B policy obliges: the typed unavailable reason has to reach the client
// so it can be turned into install guidance instead of a render failure.

let workDirRoot: string;
let originalWorkDir: string | undefined;

beforeAll(() => {
  workDirRoot = mkdtempSync(path.join(tmpdir(), 'video-engines-'));
  originalWorkDir = process.env.NEUMA_VIDEO_WORKDIR;
  process.env.NEUMA_VIDEO_WORKDIR = workDirRoot;
});

afterAll(() => {
  rmSync(workDirRoot, { recursive: true, force: true });
  if (originalWorkDir === undefined) delete process.env.NEUMA_VIDEO_WORKDIR;
  else process.env.NEUMA_VIDEO_WORKDIR = originalWorkDir;
});

describe('GET /video/engines', () => {
  it('lists every registered engine with its tradeoffs and availability', async () => {
    const res = await videoRoutes.request('/engines');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      schema: string;
      engines: Array<{
        id: string;
        installed: boolean;
        unavailableReason?: string;
        bestFor: string[];
        weaknesses: string[];
        outputFormats: string[];
      }>;
      recommendedEngineId?: string;
    };

    expect(json.schema).toBe('neuma.video.engine-options.v1');
    expect(json.engines.map((engine) => engine.id)).toEqual([
      'remotion',
      'hyperframes',
      'html',
    ]);
    const hyperframes = json.engines.find(
      (engine) => engine.id === 'hyperframes',
    )!;
    expect(hyperframes.bestFor.length).toBeGreaterThan(0);
    expect(hyperframes.outputFormats).toContain('webm-alpha');
    // Availability is host-dependent, but the contract is not: an engine that
    // is not usable must carry a typed reason rather than an opaque flag.
    if (!hyperframes.installed) {
      expect(['not-found', 'version-too-old', 'browser-missing']).toContain(
        hyperframes.unavailableReason,
      );
    }
  }, 60_000);
});

describe('POST /video/projects/:id/html-check', () => {
  it('escalates the typed HyperFrames reason as a 502 instead of a bare 500', async () => {
    vi.stubEnv('NEUMA_HYPERFRAMES_BIN', '/nonexistent/hyperframes-bin');
    try {
      const res = await videoRoutes.request(
        '/projects/check-project/html-check',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ compositionDir: 'hyperframes' }),
        },
      );
      expect(res.status).toBe(502);
      const json = (await res.json()) as {
        error: string;
        detail?: { code?: string };
      };
      expect(json.detail?.code).toBe('not-found');
    } finally {
      vi.unstubAllEnvs();
    }
  }, 60_000);

  it('rejects a composition directory that escapes the project root', async () => {
    const res = await videoRoutes.request(
      '/projects/check-project/html-check',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compositionDir: '../../etc' }),
      },
    );
    expect(res.status).toBe(422);
  });
});
