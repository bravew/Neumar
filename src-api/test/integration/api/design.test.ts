import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

describe('DesignMode API live artifacts', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'neuma-design-api-home-'),
    );
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'neuma-design-api-work-'),
    );
    vi.stubEnv('HOME', tempHome);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('workDir', workDir);
  });

  afterEach(async () => {
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('enforces Design chat owner authority and idempotent request identity', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { getDatabase } = await import('@/shared/db');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Run context project',
      surface: 'prototype',
    });
    const otherProject = await createDesignProject({
      title: 'Other project',
      surface: 'prototype',
    });

    const missing = await designRoutes.request(
      '/projects/design_missing123/chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'Build it', provider: 'mock' }),
      },
    );
    expect(missing.status).toBe(404);

    const mismatch = await designRoutes.request(
      `/projects/${project.id}/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Build it',
          provider: 'mock',
          runContext: { projectId: otherProject.id },
        }),
      },
    );
    expect(mismatch.status).toBe(409);

    const request = {
      prompt: 'Build a compact dashboard',
      provider: 'mock',
      model: 'hello',
      runContext: {
        mode: 'design',
        projectId: project.id,
        conversationId: null,
        clientRequestId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
        supplementalSkillIds: [],
      },
    };
    const [first, duplicate] = await Promise.all([
      designRoutes.request(`/projects/${project.id}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),
      designRoutes.request(`/projects/${project.id}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      }),
    ]);
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    await Promise.all([first.text(), duplicate.text()]);

    const runs = getDatabase()
      .prepare(
        `SELECT id, mode, owner_key, client_request_id, request_message_id
         FROM agent_runs
         WHERE mode = 'design' AND owner_key = ?`,
      )
      .all(project.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      mode: 'design',
      owner_key: project.id,
      client_request_id: request.runContext.clientRequestId,
      request_message_id: request.runContext.messageId,
    });
    const events = getDatabase()
      .prepare(
        `SELECT seq, event_type FROM agent_run_events
         WHERE run_id = ? AND seq >= 0 ORDER BY seq`,
      )
      .all((runs[0] as { id: string }).id) as Array<{
      seq: number;
      event_type: string;
    }>;
    expect(events[0]).toMatchObject({ seq: 0, event_type: 'RUN_STARTED' });
    expect(
      events.filter(
        (event) =>
          event.event_type === 'RUN_FINISHED' ||
          event.event_type === 'RUN_ERROR',
      ),
    ).toHaveLength(1);
    expect(events.map((event) => event.seq)).toEqual(
      events.map((_, index) => index),
    );
  });

  it('keeps raw Design rollback failures journaled', async () => {
    vi.stubEnv('NEUMA_DESIGN_RAW_STREAM_ROLLBACK', '1');
    const { designRoutes } = await import('@/app/api/design');
    const { getDatabase } = await import('@/shared/db');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Rollback journal project',
      surface: 'prototype',
    });

    const response = await designRoutes.request(
      `/projects/${project.id}/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Build a compact dashboard',
          provider: 'mock',
          model: 'hello',
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('event: error');

    const run = getDatabase()
      .prepare(
        `SELECT id FROM agent_runs
         WHERE mode = 'design' AND owner_key = ?`,
      )
      .get(project.id) as { id: string };
    const events = getDatabase()
      .prepare(
        `SELECT seq, event_type FROM agent_run_events
         WHERE run_id = ? AND seq >= 0 ORDER BY seq`,
      )
      .all(run.id) as Array<{ seq: number; event_type: string }>;
    expect(events[0]).toMatchObject({ seq: 0, event_type: 'RUN_STARTED' });
    expect(events.at(-1)?.event_type).toBe('RUN_ERROR');
  });

  it('exposes connector catalog and live-artifact CRUD/refresh routes', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'API live report',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/data.json',
      JSON.stringify({ visitors: 12 }),
    );

    const connectors = await designRoutes.request('/connectors');
    expect(connectors.status).toBe(200);
    await expect(connectors.json()).resolves.toMatchObject({
      connectors: expect.arrayContaining([
        expect.objectContaining({ id: 'project-json', access: 'read' }),
      ]),
    });

    const created = await designRoutes.request(
      `/projects/${project.id}/live-artifacts`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Visitors',
          source: { kind: 'project-file', path: 'artifacts/data.json' },
          templateHtml: '<main>{{DATA_JSON}}</main>',
        }),
      },
    );
    expect(created.status).toBe(201);
    const createdData = (await created.json()) as {
      liveArtifact: { id: string; status: string };
    };
    expect(createdData.liveArtifact.status).toBe('ready');

    const listed = await designRoutes.request(
      `/projects/${project.id}/live-artifacts`,
    );
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      liveArtifacts: expect.arrayContaining([
        expect.objectContaining({ id: createdData.liveArtifact.id }),
      ]),
    });

    await writeProjectTextFile(
      project.id,
      'artifacts/data.json',
      JSON.stringify({ visitors: 13 }),
    );
    const refreshed = await designRoutes.request(
      `/projects/${project.id}/live-artifacts/${createdData.liveArtifact.id}/refresh`,
      { method: 'POST' },
    );
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      liveArtifact: { status: 'ready' },
    });

    const detail = await designRoutes.request(
      `/projects/${project.id}/live-artifacts/${createdData.liveArtifact.id}`,
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      artifact: { id: createdData.liveArtifact.id },
      provenance: { connectorId: 'project-json' },
    });
  });

  it('protects built-in design skills from uninstall', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const listed = await designRoutes.request('/skills');
    expect(listed.status).toBe(200);
    const data = (await listed.json()) as {
      skills: Array<{ id: string; origin?: string }>;
    };
    const builtin = data.skills.find((skill) => skill.origin === 'builtin');
    expect(builtin).toBeTruthy();

    const response = await designRoutes.request(
      `/skills/${encodeURIComponent(builtin!.id)}/install`,
      { method: 'DELETE' },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'BUILTIN_PROTECTED' },
    });
  });

  it('lists recent critique metrics', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { recordDesignCritiqueMetrics } =
      await import('@/shared/services/design-mode/critique/observability/metrics');
    recordDesignCritiqueMetrics({
      runId: 'jury_api_metric1',
      projectId: 'design_api_metric',
      rolloutPhase: 'M1',
      outcome: 'shipped',
      panelistCount: 5,
      mustFixCount: 1,
      totalScore: 8,
      durationMs: 1000,
      conformanceOk: true,
      degradedPanelistCount: 0,
      startedAt: '2026-05-15T00:00:00.000Z',
      endedAt: '2026-05-15T00:00:01.000Z',
    });

    const response = await designRoutes.request(
      '/critique/metrics?since=2026-05-14T00%3A00%3A00.000Z',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      metrics: [
        expect.objectContaining({
          runId: 'jury_api_metric1',
          outcome: 'shipped',
          conformanceOk: true,
        }),
      ],
    });
  });

  it('serves critique conformance and rollout controls', async () => {
    const { designRoutes } = await import('@/app/api/design');

    const conformance = await designRoutes.request('/critique/conformance');
    expect(conformance.status).toBe(200);
    await expect(conformance.json()).resolves.toMatchObject({
      report: { summary: { failed: 0 } },
      ratchet: { current: 'M0', canPromote: true },
    });

    const rollout = await designRoutes.request('/critique/rollout');
    expect(rollout.status).toBe(200);
    await expect(rollout.json()).resolves.toMatchObject({
      rollout: { phase: 'M0', rolloutPhase: 'M0', canPromote: true },
    });

    const promoted = await designRoutes.request('/critique/rollout/promote', {
      method: 'POST',
    });
    expect(promoted.status).toBe(200);
    await expect(promoted.json()).resolves.toMatchObject({
      rollout: { rolloutPhase: 'M1' },
    });

    const rollback = await designRoutes.request('/critique/rollout/rollback', {
      method: 'POST',
    });
    expect(rollback.status).toBe(200);
    await expect(rollback.json()).resolves.toMatchObject({
      rollout: { rolloutPhase: 'M0', userOverride: 'auto' },
    });
  });

  it('serves cached ElevenLabs voices for DesignMode media UI', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'eleven-test-key');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/voices')) {
        return new Response(
          JSON.stringify({
            voices: [
              {
                voice_id: '21m00Tcm4TlvDq8ikWAM',
                name: 'Rachel',
                category: 'premade',
                labels: { language: 'English', gender: 'female' },
                preview_url: 'https://example.com/rachel.mp3',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/v1/shared-voices')) {
        return new Response(JSON.stringify({ voices: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { designRoutes } = await import('@/app/api/design');
      const first = await designRoutes.request(
        '/media/voices?provider=elevenlabs',
      );
      const second = await designRoutes.request(
        '/media/voices?provider=elevenlabs',
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.headers.get('cache-control')).toContain('max-age=300');
      const body = (await first.json()) as { voices: unknown[] };
      expect(body.voices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: '21m00Tcm4TlvDq8ikWAM',
            name: '[ElevenLabs] Rachel',
            language: 'en',
            category: 'premade',
          }),
        ]),
      );
      expect(fetchMock).toHaveBeenCalledTimes(5);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('defaults preview comments into the next chat batch', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Comment batch',
      surface: 'prototype',
    });

    const created = await designRoutes.request(
      `/projects/${project.id}/comments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: {
            file: 'artifacts/index.html',
            id: 'hero-cta',
            label: 'Hero CTA',
          },
          text: 'Make the CTA more specific.',
        }),
      },
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      comment: {
        status: 'open',
        attachToChat: true,
        target: { id: 'hero-cta' },
      },
    });
  });

  it('persists draw attachments on preview comments', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Draw comments',
      surface: 'prototype',
    });

    const created = await designRoutes.request(
      `/projects/${project.id}/comments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: { file: 'artifacts/index.html', role: 'draw' },
          text: 'Draw annotation attached.',
          attachments: [
            {
              kind: 'draw',
              strokes: [
                {
                  id: 'stroke_1',
                  pointerType: 'mouse',
                  color: '#2563eb',
                  width: 3,
                  points: [
                    { x: 1, y: 2 },
                    { x: 3, y: 4 },
                  ],
                },
              ],
              viewport: { width: 800, height: 600, scale: 1 },
            },
          ],
        }),
      },
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      comment: {
        attachments: [
          {
            kind: 'draw',
            strokes: [{ id: 'stroke_1' }],
          },
        ],
      },
    });
  });

  it('materializes image and note attachments on preview comments', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Image comments',
      surface: 'prototype',
    });
    const image = Buffer.from(PNG_1X1_BASE64, 'base64');

    const created = await designRoutes.request(
      `/projects/${project.id}/comments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target: { file: 'artifacts/index.html', id: 'hero' },
          text: 'Use this screenshot.',
          attachments: [
            {
              kind: 'image',
              name: 'hero.png',
              mime: 'image/png',
              size: image.length,
              dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}`,
              alt: 'Hero screenshot',
            },
            { kind: 'note', text: 'Crop around the CTA.' },
          ],
        }),
      },
    );

    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      comment: {
        attachments: Array<{
          kind: string;
          path?: string;
          dataUrl?: string;
          text?: string;
        }>;
      };
    };
    expect(body.comment.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image',
          name: 'hero.png',
          mime: 'image/png',
          size: image.length,
          alt: 'Hero screenshot',
        }),
        expect.objectContaining({
          kind: 'note',
          text: 'Crop around the CTA.',
        }),
      ]),
    );
    const storedImage = body.comment.attachments.find(
      (attachment) => attachment.kind === 'image',
    );
    expect(storedImage?.dataUrl).toBeUndefined();
    expect(storedImage?.path).toMatch(/^comments\/attachments\/.+_hero\.png$/);
    await expect(
      fs.readFile(
        resolveProjectPath(project.id, storedImage!.path!).absolutePath,
      ),
    ).resolves.toEqual(image);

    const rejected = await designRoutes.request(
      `/projects/${project.id}/comments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Unsafe filename.',
          attachments: [
            {
              kind: 'image',
              name: '../hero.png',
              mime: 'image/png',
              size: image.length,
              dataUrl: `data:image/png;base64,${PNG_1X1_BASE64}`,
            },
          ],
        }),
      },
    );
    expect(rejected.status).toBe(400);
  });

  it('rejects oversized draw strokes on preview comments', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Oversized draw comments',
      surface: 'prototype',
    });

    const rejected = await designRoutes.request(
      `/projects/${project.id}/comments`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: 'Too large',
          attachments: [
            {
              kind: 'draw',
              strokes: [
                {
                  id: 'stroke_big',
                  pointerType: 'mouse',
                  color: '#2563eb',
                  width: 3,
                  points: Array.from({ length: 600 }, (_, index) => ({
                    x: index,
                    y: index,
                  })),
                },
              ],
              viewport: { width: 800, height: 600, scale: 1 },
            },
          ],
        }),
      },
    );

    expect(rejected.status).toBe(400);
  });

  it('persists assistant message feedback', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Feedback',
      surface: 'prototype',
    });

    const created = await designRoutes.request(
      `/projects/${project.id}/messages/msg_1/feedback`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rating: 'down',
          comment: 'Needs more contrast.',
          submittedAt: '2026-05-12T00:00:00.000Z',
        }),
      },
    );

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      feedback: { messageId: 'msg_1', rating: 'down' },
    });
    const stored = JSON.parse(
      await fs.readFile(
        resolveProjectPath(project.id, 'comments/message-feedback.json')
          .absolutePath,
        'utf-8',
      ),
    ) as Array<{ messageId: string; comment?: string }>;
    expect(stored[0]).toMatchObject({
      messageId: 'msg_1',
      comment: 'Needs more contrast.',
    });

    const oversized = await designRoutes.request(
      `/projects/${project.id}/messages/msg_2/feedback`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rating: 'down',
          comment: 'x'.repeat(2001),
          submittedAt: '2026-05-12T00:00:00.000Z',
        }),
      },
    );
    expect(oversized.status).toBe(400);
  });

  it('serves self-contained inline HTML exports with sandbox CSP', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Inline export',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<!doctype html><link rel="stylesheet" href="print.css" media="print"><script src="../shared/app.js"></script><main>Export</main>',
    );
    await writeProjectTextFile(project.id, 'artifacts/print.css', 'main{}');
    await writeProjectTextFile(project.id, 'shared/app.js', 'console.log(1)');

    const response = await designRoutes.request(
      `/projects/${project.id}/export/file?path=artifacts%2Findex.html&inline=YES`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBe(
      'sandbox allow-scripts',
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.text();
    expect(body).toContain(
      '<style data-neuma-inline-asset="artifacts/print.css" media="print">',
    );
    expect(body).toContain('<script>console.log(1)</script>');
  });

  it('validates inline export inputs and failure-local missing assets', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Inline export validation',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<link rel="stylesheet" href="missing.css"><main>Export</main>',
    );
    await writeProjectTextFile(project.id, 'artifacts/data.json', '{}');

    const missingInline = await designRoutes.request(
      `/projects/${project.id}/export/file?path=artifacts%2Findex.html`,
    );
    expect(missingInline.status).toBe(400);
    await expect(missingInline.json()).resolves.toMatchObject({
      error: 'BAD_REQUEST',
    });

    const invalidInline = await designRoutes.request(
      `/projects/${project.id}/export/file?path=artifacts%2Findex.html&inline=0`,
    );
    expect(invalidInline.status).toBe(400);

    const missingFile = await designRoutes.request(
      `/projects/${project.id}/export/file?path=artifacts%2Fmissing.html&inline=1`,
    );
    expect(missingFile.status).toBe(404);
    await expect(missingFile.json()).resolves.toMatchObject({
      error: 'FILE_NOT_FOUND',
    });

    const nonHtml = await designRoutes.request(
      `/projects/${project.id}/export/file?path=artifacts%2Fdata.json&inline=1`,
    );
    expect(nonHtml.status).toBe(400);
    await expect(nonHtml.json()).resolves.toMatchObject({
      error: 'UNSUPPORTED_FILE_TYPE',
    });

    const traversal = await designRoutes.request(
      `/projects/${project.id}/export/file?path=..%2Fsecret.html&inline=1`,
    );
    expect(traversal.status).toBe(400);

    const invalidProject = await designRoutes.request(
      '/projects/not-valid/export/file?path=artifacts%2Findex.html&inline=1',
    );
    expect(invalidProject.status).toBe(400);

    const missingAsset = await designRoutes.request(
      `/projects/${project.id}/export/file?path=artifacts%2Findex.html&inline=true`,
    );
    expect(missingAsset.status).toBe(200);
    await expect(missingAsset.text()).resolves.toContain(
      '<link rel="stylesheet" href="missing.css">',
    );
  });

  it('keeps Design Jury API routes gated by default', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const project = await createDesignProject({
      title: 'Gated jury',
      surface: 'prototype',
    });

    const status = await designRoutes.request('/design-jury/status');
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({ enabled: false });

    const created = await designRoutes.request(
      `/projects/${project.id}/design-jury`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );

    expect(created.status).toBe(404);
    await expect(created.json()).resolves.toEqual({
      error: 'Design Jury is disabled',
    });
  });

  it('serves shipped Design Jury artifacts without exposing file paths', async () => {
    vi.stubEnv('DESIGN_MODE_JURY_ENABLED', 'true');
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Jury artifact',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<!doctype html><html><head><title>Jury</title></head><body><main><h1>Reviewable artifact</h1><button>Save</button></main></body></html>',
    );

    const created = await designRoutes.request(
      `/projects/${project.id}/design-jury`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactPath: 'artifacts/index.html' }),
      },
    );
    expect(created.status).toBe(201);
    const createdData = (await created.json()) as {
      run: { id: string; artifactRef?: { url: string; sha256: string } };
    };
    expect(createdData.run.artifactRef?.url).toBe(
      `/design/projects/${project.id}/design-jury/${createdData.run.id}/artifact`,
    );

    const artifact = await designRoutes.request(
      `/projects/${project.id}/design-jury/${createdData.run.id}/artifact`,
    );
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get('content-type')).toBe('text/html');
    expect(artifact.headers.get('x-content-type-options')).toBe('nosniff');
    expect(artifact.headers.get('cache-control')).toBe('private, no-store');
    const body = await artifact.text();
    expect(body).toContain('<!doctype html>');
    expect(body).not.toContain(workDir);

    const missing = await designRoutes.request(
      `/projects/${project.id}/design-jury/jury_missing/artifact`,
    );
    expect(missing.status).toBe(404);
  });

  it('replays Design Jury panel events over SSE and hides cross-project runs', async () => {
    vi.stubEnv('DESIGN_MODE_JURY_ENABLED', 'true');
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Jury events',
      surface: 'prototype',
    });
    const otherProject = await createDesignProject({
      title: 'Other jury events',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<!doctype html><html><body><main><h1>Event stream</h1><button>Save</button></main></body></html>',
    );

    const created = await designRoutes.request(
      `/projects/${project.id}/design-jury`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifactPath: 'artifacts/index.html' }),
      },
    );
    const createdData = (await created.json()) as { run: { id: string } };
    const events = await designRoutes.request(
      `/projects/${project.id}/design-jury/${createdData.run.id}/events`,
    );

    expect(events.status).toBe(200);
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    const body = await events.text();
    expect(body).toContain('"type":"run_started"');
    expect(body).toContain('"type":"shipped"');
    expect(body).toContain('event: done');

    const mismatch = await designRoutes.request(
      `/projects/${otherProject.id}/design-jury/${createdData.run.id}/events`,
    );
    expect(mismatch.status).toBe(404);
  });

  it('finalizes a project and reports DESIGN.md state', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Finalize route',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<!doctype html><html><body><main>Route artifact</main></body></html>',
    );

    const missingState = await designRoutes.request(
      `/projects/${project.id}/finalize/state`,
    );
    await expect(missingState.json()).resolves.toMatchObject({
      state: { exists: false },
    });

    const finalized = await designRoutes.request(
      `/projects/${project.id}/finalize`,
      { method: 'POST' },
    );
    expect(finalized.status).toBe(201);
    await expect(finalized.json()).resolves.toMatchObject({
      result: {
        path: 'DESIGN.md',
        state: {
          exists: true,
          currentArtifact: 'artifacts/index.html',
          isStale: false,
        },
      },
    });
  });

  it('serves media blobs with single-range support', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Range route',
      surface: 'video',
    });
    const videoPath = resolveProjectPath(
      project.id,
      'artifacts/demo.mp4',
    ).absolutePath;
    await fs.mkdir(path.dirname(videoPath), { recursive: true });
    await fs.writeFile(videoPath, Buffer.from('0123456789'));
    await writeProjectTextFile(project.id, 'artifacts/readme.txt', 'hello');

    const full = await designRoutes.request(
      `/projects/${project.id}/blob?path=artifacts%2Fdemo.mp4`,
    );
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-length')).toBe('10');
    await expect(full.text()).resolves.toBe('0123456789');

    const partial = await designRoutes.request(
      `/projects/${project.id}/blob?path=artifacts%2Fdemo.mp4`,
      { headers: { range: 'bytes=2-5' } },
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(partial.headers.get('content-length')).toBe('4');
    await expect(partial.text()).resolves.toBe('2345');

    const unsatisfiable = await designRoutes.request(
      `/projects/${project.id}/blob?path=artifacts%2Fdemo.mp4`,
      { headers: { range: 'bytes=99-120' } },
    );
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get('content-range')).toBe('bytes */10');

    const malformed = await designRoutes.request(
      `/projects/${project.id}/blob?path=artifacts%2Fdemo.mp4`,
      { headers: { range: 'bytes=0-1,4-5' } },
    );
    expect(malformed.status).toBe(200);
    await expect(malformed.text()).resolves.toBe('0123456789');

    const nonMedia = await designRoutes.request(
      `/projects/${project.id}/blob?path=artifacts%2Freadme.txt`,
      { headers: { range: 'bytes=0-1' } },
    );
    expect(nonMedia.status).toBe(200);
    expect(nonMedia.headers.get('accept-ranges')).toBeNull();
    await expect(nonMedia.text()).resolves.toBe('hello');
  });

  it('renames files safely and updates project outputs', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject, patchDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Rename route',
      surface: 'prototype',
    });
    await writeProjectTextFile(project.id, 'artifacts/old.html', '<main />');
    await writeProjectTextFile(project.id, 'artifacts/existing.html', '<p />');
    await patchDesignProject(project.id, {
      outputs: [
        {
          id: 'output_old',
          kind: 'html',
          path: 'artifacts/old.html',
          createdAt: '2026-05-10T00:00:00.000Z',
        },
      ],
    });

    const renamed = await designRoutes.request(
      `/projects/${project.id}/files/rename`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: 'artifacts/old.html',
          to: 'artifacts/new.html',
        }),
      },
    );
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({
      file: { from: 'artifacts/old.html', path: 'artifacts/new.html' },
      project: { outputs: [{ path: 'artifacts/new.html' }] },
    });

    const conflict = await designRoutes.request(
      `/projects/${project.id}/files/rename`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: 'artifacts/new.html',
          to: 'artifacts/existing.html',
        }),
      },
    );
    expect(conflict.status).toBe(409);

    const invalid = await designRoutes.request(
      `/projects/${project.id}/files/rename`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from: '../outside.html',
          to: 'artifacts/next.html',
        }),
      },
    );
    expect(invalid.status).toBe(400);
  });
});
