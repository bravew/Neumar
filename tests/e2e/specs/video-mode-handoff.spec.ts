import type { APIRequestContext } from '@playwright/test';
import JSZip from 'jszip';

import { test, expect } from '../fixtures/base';

import fs from 'node:fs/promises';

const API_BASE = 'http://127.0.0.1:5126';

type VideoProject = {
  id: string;
  name: string;
  assets: Array<{ id: string; kind: string; path: string }>;
  timeline?: VideoTimeline;
  history?: {
    head: number;
    entries: Array<{ op: { kind: string; ops?: Array<{ kind: string }> } }>;
  };
};

type VideoTimeline = {
  schema: 'neuma.video.timeline.v1';
  fps: number;
  durationMs: number;
  tracks: Array<{
    id: string;
    kind: string;
    name: string;
    muted: boolean;
    locked: boolean;
    hidden?: boolean;
    order: number;
    clips: Array<{
      id: string;
      kind: string;
      name?: string;
      sourceRef: Record<string, string>;
      sceneId?: string;
      startMs: number;
      durationMs: number;
      trimStartMs: number;
      trimEndMs: number;
      sourceDurationMs?: number;
      text?: string;
      tokens?: Array<{
        id: string;
        text: string;
        startMs: number;
        endMs: number;
      }>;
      transitionToNext?: unknown;
      params?: Record<string, unknown>;
    }>;
  }>;
};

test.describe('Video mode agentic editing and handoff', () => {
  test.setTimeout(120_000);

  const createdProjectIds: string[] = [];

  test.afterEach(async ({ request }) => {
    while (createdProjectIds.length > 0) {
      const id = createdProjectIds.pop();
      if (id) {
        await request
          .delete(`${API_BASE}/video/projects/${id}`)
          .catch(() => {});
      }
    }
  });

  test('verifies batch timeline ops, transcript context, and editor handoff package', async ({
    context,
    page,
    request,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/video/');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByRole('heading', { name: 'Video projects' }),
    ).toBeVisible();

    const browserWorkDir = await page.evaluate(() => {
      const raw = window.localStorage.getItem('neumar_settings');
      if (!raw) return null;
      const settings = JSON.parse(raw) as { workDir?: string };
      return settings.workDir ?? null;
    });
    expect(browserWorkDir).toBeTruthy();
    const expectedWorkDir = expandHomePath(browserWorkDir);
    await expect
      .poll(
        async () => {
          const response = await request.get(`${API_BASE}/db/settings/workDir`);
          if (!response.ok()) return null;
          const data = (await response.json()) as { value?: string };
          return data.value ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(expectedWorkDir);

    const projectName = `Handoff video ${crypto.randomUUID()}`;
    const createResponse = await request.post(`${API_BASE}/video/projects`, {
      data: {
        name: projectName,
        template: 'explainer',
        prompt: 'Verify agentic editing handoff.',
        aspectRatio: '16:9',
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const { project } = (await createResponse.json()) as {
      project: VideoProject;
    };
    createdProjectIds.push(project.id);

    const alphaAsset = await uploadAsset(request, project.id, {
      name: 'alpha-pr260.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('alpha video fixture'),
    });
    const betaAsset = await uploadAsset(request, project.id, {
      name: 'beta-pr260.mov',
      mimeType: 'video/quicktime',
      buffer: Buffer.from('beta video fixture'),
    });

    await patchProject(request, project.id, {
      analysisArtifacts: [
        {
          id: 'analysis-silence-pr260',
          kind: 'silence-ranges',
          sourceMediaId: alphaAsset.id,
          summary: 'Silence range proposed for PR verification',
          ranges: [
            {
              id: 'silence-edge',
              startMs: 0,
              endMs: 500,
              confidence: 0.91,
            },
          ],
          proposedActionBatch: {
            id: 'batch-edge-cut',
            summary: 'Trim the opening silence',
            ops: [
              {
                kind: 'clip.removeTimeRange',
                trackId: 'track-video-main',
                startMs: 0,
                endMs: 500,
                magnetic: true,
              },
            ],
          },
          generatedAt: new Date().toISOString(),
        },
      ],
    });

    await patchStoryboard(
      request,
      project.id,
      buildStoryboard(alphaAsset, betaAsset),
    );
    await patchTimeline(
      request,
      project.id,
      buildTimeline(alphaAsset, betaAsset),
    );

    const applyResponse = await request.post(
      `${API_BASE}/video/projects/${project.id}/agent/tools`,
      {
        data: {
          name: 'applyTimelineOps',
          args: {
            summary: 'Trim opening silence and update caption token',
            ops: [
              {
                kind: 'clip.removeTimeRange',
                trackId: 'track-video-main',
                startMs: 0,
                endMs: 500,
                magnetic: true,
              },
              {
                kind: 'clip.extend',
                clipId: 'clip-beta',
                deltaMs: 500,
                magnetic: true,
              },
              {
                kind: 'caption.setTokenText',
                clipId: 'caption-one',
                tokenId: 'token-now',
                before: 'now',
                after: 'today',
              },
            ],
          },
          reasoning: 'Playwright verification for video handoff.',
        },
      },
    );
    expect(applyResponse.ok()).toBeTruthy();
    const applied = (await applyResponse.json()) as { project: VideoProject };
    const videoTrack = applied.project.timeline?.tracks.find(
      (track) => track.id === 'track-video-main',
    );
    expect(
      videoTrack?.clips.find((clip) => clip.id === 'clip-alpha'),
    ).toMatchObject({
      startMs: 0,
      durationMs: 3500,
      trimStartMs: 500,
    });
    expect(
      videoTrack?.clips.find((clip) => clip.id === 'clip-beta'),
    ).toMatchObject({
      startMs: 3500,
      durationMs: 3500,
    });
    const captionTrack = applied.project.timeline?.tracks.find(
      (track) => track.id === 'track-caption',
    );
    expect(captionTrack?.clips[0]).toMatchObject({
      id: 'caption-one',
      text: 'Launch today',
    });
    expect(applied.project.history?.entries.at(-1)?.op).toMatchObject({
      kind: 'timeline.batch',
      ops: [
        { kind: 'clip.removeTimeRange' },
        { kind: 'clip.extend' },
        { kind: 'caption.setTokenText' },
      ],
    });

    let agentRequestBody: unknown;
    await page.route(`**/video/projects/${project.id}/agent`, async (route) => {
      agentRequestBody = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: [
          `event: session`,
          `data: ${JSON.stringify({ type: 'session', sessionId: `video:${project.id}` })}`,
          '',
          `event: message`,
          `data: ${JSON.stringify({ type: 'text', sessionId: `video:${project.id}`, content: 'Selection received.' })}`,
          '',
          `event: done`,
          `data: ${JSON.stringify({ type: 'done', sessionId: `video:${project.id}` })}`,
          '',
        ].join('\n'),
      });
    });

    let revealRequestPath: string | undefined;
    await page.route('**/files/open', async (route) => {
      const body = route.request().postDataJSON() as { path?: string };
      revealRequestPath = body.path;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    const readableBeforeNavigation = await request.get(
      `${API_BASE}/video/projects/${project.id}`,
    );
    expect(readableBeforeNavigation.ok()).toBeTruthy();

    await page.goto('/video/');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByRole('heading', { name: 'Video projects' }),
    ).toBeVisible();

    const projectCard = page
      .getByRole('button', { name: new RegExp(escapeRegExp(projectName)) })
      .first();
    await expect(projectCard).toBeVisible({ timeout: 30_000 });
    await projectCard.click();
    await page.waitForURL(new RegExp(`/video/${escapeRegExp(project.id)}$`), {
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole('button', { name: 'Editor handoff' }),
    ).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Transcript' }),
    ).toBeVisible();

    const transcript = page.getByLabel('Scene transcript text').first();
    await expect(transcript).toHaveValue('Launch now');
    await transcript.focus();
    await transcript.evaluate((node) => {
      const textarea = node as HTMLTextAreaElement;
      textarea.setSelectionRange(7, 10);
      textarea.dispatchEvent(new Event('select', { bubbles: true }));
      textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const agentToggle = page.getByRole('button', {
      name: 'Agent',
      exact: true,
    });
    if ((await agentToggle.getAttribute('aria-pressed')) !== 'true') {
      await agentToggle.click();
    }
    await page
      .getByPlaceholder(
        'Ask for a scene edit, caption, music, narration, or render.',
      )
      .fill('Cut the selected transcript text.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect
      .poll(() => agentRequestBody, { timeout: 10_000 })
      .toMatchObject({
        message: 'Cut the selected transcript text.',
        mode: 'chat',
        context: {
          transcriptSelection: {
            sceneId: 'scene-1',
            clipId: 'clip-alpha',
            startMs: 2800,
            endMs: 4000,
            text: 'now',
          },
        },
      });

    await page.getByRole('button', { name: 'Editor handoff' }).click();
    for (const label of [
      'Final Cut Pro',
      'Premiere Pro',
      'DaVinci Resolve',
      'OTIO',
      'EDL',
      'CapCut fallback',
    ]) {
      await expect(page.getByLabel(label)).toBeVisible();
    }
    await expect(page.getByText('Targets', { exact: true })).toBeVisible();
    await expect(page.getByText('Media', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Link media' }).click();
    await page.getByRole('button', { name: 'Copy media' }).click();
    await page.getByLabel('OTIO').check();
    await page.getByLabel('EDL').check();
    await page.getByLabel('CapCut fallback').check();

    const queueResponse = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/video/projects/${project.id}/editor-handoff`) &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Export handoff package' }).click();
    const queued = (await (await queueResponse).json()) as {
      job: { id: string };
    };

    const status = await waitForHandoffDone(request, project.id, queued.job.id);
    expect(status).toMatchObject({
      job: { status: 'done' },
      packagePath: expect.stringMatching(/neuma-video-handoff\.zip$/),
      conformance: {
        targets: expect.arrayContaining([
          expect.objectContaining({
            target: 'final-cut-pro',
            support: 'generated-unverified',
          }),
          expect.objectContaining({
            target: 'premiere-pro',
            support: 'generated-unverified',
          }),
          expect.objectContaining({
            target: 'resolve',
            support: 'generated-unverified',
          }),
          expect.objectContaining({
            target: 'otio',
            support: 'generated-unverified',
          }),
          expect.objectContaining({
            target: 'edl',
            support: 'generated-unverified',
          }),
          expect.objectContaining({
            target: 'capcut-fallback',
            support: 'fallback-only',
          }),
        ]),
      },
    });

    await expect(page.getByText('Done')).toBeVisible({ timeout: 35_000 });
    await expect(page.getByText(/\d+ warnings · \d+ errors/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Reveal package' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy path' })).toBeVisible();

    const packagePath = status.packagePath;
    expect(packagePath).toBeTruthy();
    await fs.access(packagePath!);

    const zip = await JSZip.loadAsync(await fs.readFile(packagePath!));
    const zipFiles = Object.keys(zip.files);
    expect(zipFiles).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'media/manifest.json',
        'analysis/manifest.json',
        'actions/action-log.json',
        'captions/captions.srt',
        'cut-list.json',
        'interchange/timeline.otio',
        'interchange/timeline.fcpxml',
        'interchange/timeline-premiere.xml',
        'interchange/timeline.edl',
        'conformance.json',
      ]),
    );
    expect(
      zipFiles.some(
        (file) => file.startsWith('media/') && file.endsWith('.mp4'),
      ),
    ).toBe(true);
    expect(
      zipFiles.some(
        (file) => file.startsWith('media/') && file.endsWith('.mov'),
      ),
    ).toBe(true);

    const manifest = JSON.parse(
      await zip.file('manifest.json')!.async('string'),
    ) as {
      schema: string;
      targets: string[];
      mediaMode: string;
      generatedSidecars: string[];
    };
    expect(manifest).toMatchObject({
      schema: 'neuma.video.editor-handoff.manifest.v1',
      mediaMode: 'copy',
      targets: expect.arrayContaining([
        'final-cut-pro',
        'premiere-pro',
        'resolve',
        'otio',
        'edl',
        'capcut-fallback',
      ]),
      generatedSidecars: expect.arrayContaining([
        'actions/action-log.json',
        'analysis/manifest.json',
        'captions/captions.srt',
        'conformance.json',
        'cut-list.json',
        'interchange/timeline.edl',
        'interchange/timeline.fcpxml',
        'interchange/timeline-premiere.xml',
        'interchange/timeline.otio',
        'media/derivatives.json',
        'media/manifest.json',
      ]),
    });

    const actionLog = JSON.parse(
      await zip.file('actions/action-log.json')!.async('string'),
    ) as Array<{
      summary?: string;
      operation?: { ops?: Array<{ kind: string }> };
    }>;
    expect(actionLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: 'Trim opening silence and update caption token',
          operation: expect.objectContaining({
            ops: expect.arrayContaining([
              expect.objectContaining({ kind: 'clip.removeTimeRange' }),
              expect.objectContaining({ kind: 'clip.extend' }),
              expect.objectContaining({ kind: 'caption.setTokenText' }),
            ]),
          }),
        }),
      ]),
    );

    await page.getByRole('button', { name: 'Reveal package' }).click();
    await expect.poll(() => revealRequestPath).toBe(packagePath);
    await page.getByRole('button', { name: 'Copy path' }).click();
    await expect(page.getByText('Package path copied')).toBeVisible();
  });
});

async function uploadAsset(
  request: APIRequestContext,
  projectId: string,
  file: { name: string; mimeType: string; buffer: Buffer },
) {
  const response = await request.post(
    `${API_BASE}/video/projects/${projectId}/assets`,
    {
      multipart: {
        file,
      },
    },
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    assets: Array<{ id: string; kind: string; path: string }>;
  };
  expect(body.assets[0]).toBeTruthy();
  return body.assets[0]!;
}

async function patchProject(
  request: APIRequestContext,
  projectId: string,
  patch: Record<string, unknown>,
) {
  const response = await request.patch(
    `${API_BASE}/video/projects/${projectId}`,
    {
      data: patch,
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function patchStoryboard(
  request: APIRequestContext,
  projectId: string,
  storyboard: Record<string, unknown>,
) {
  const response = await request.patch(
    `${API_BASE}/video/projects/${projectId}/storyboard`,
    {
      data: { patch: storyboard },
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function patchTimeline(
  request: APIRequestContext,
  projectId: string,
  timeline: VideoTimeline,
) {
  const response = await request.patch(
    `${API_BASE}/video/projects/${projectId}/timeline`,
    {
      data: { timeline },
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function waitForHandoffDone(
  request: APIRequestContext,
  projectId: string,
  jobId: string,
) {
  let status: {
    job: { status: string; result?: Record<string, unknown> };
    packagePath?: string;
    conformance?: {
      warningCount: number;
      errorCount: number;
      targets: Array<{ target: string; support: string }>;
    };
  } | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${API_BASE}/video/projects/${projectId}/editor-handoff/${jobId}`,
        );
        if (!response.ok()) return 'pending';
        status = (await response.json()) as NonNullable<typeof status>;
        return status.job.status;
      },
      { timeout: 30_000 },
    )
    .toBe('done');
  expect(status).toBeTruthy();
  return status!;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expandHomePath(value: string | null): string | null {
  if (!value?.startsWith('~/')) return value;
  return `${process.env.HOME}${value.slice(1)}`;
}

function buildStoryboard(
  alphaAsset: { id: string },
  betaAsset: { id: string },
) {
  return {
    status: 'approved',
    intent: 'Verify handoff and timeline editing.',
    totalDurationMs: 7000,
    costEstimateUsd: { low: 0, high: 0 },
    scenes: [
      {
        id: 'scene-1',
        durationMs: 4000,
        intent: 'Launch now',
        caption: { text: 'Launch now' },
        assetPlan: { kind: 'existing', assetId: alphaAsset.id },
      },
      {
        id: 'scene-2',
        durationMs: 3000,
        intent: 'Follow-up beta scene',
        caption: { text: 'Follow-up beta scene' },
        assetPlan: { kind: 'existing', assetId: betaAsset.id },
      },
    ],
    narration: {
      segments: [
        {
          id: 'narration-1',
          sceneId: 'scene-1',
          text: 'Launch now',
        },
      ],
    },
  };
}

function buildTimeline(
  alphaAsset: { id: string },
  betaAsset: { id: string },
): VideoTimeline {
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 30,
    durationMs: 7000,
    tracks: [
      {
        id: 'track-video-main',
        kind: 'video',
        name: 'Video 1',
        muted: false,
        locked: false,
        hidden: false,
        order: 0,
        clips: [
          {
            id: 'clip-alpha',
            kind: 'video',
            name: 'Alpha',
            sourceRef: { kind: 'asset', assetId: alphaAsset.id },
            sceneId: 'scene-1',
            startMs: 0,
            durationMs: 4000,
            trimStartMs: 0,
            trimEndMs: 4000,
            sourceDurationMs: 10000,
            transitionToNext: { kind: 'fade', durationMs: 300 },
          },
          {
            id: 'clip-beta',
            kind: 'video',
            name: 'Beta',
            sourceRef: { kind: 'asset', assetId: betaAsset.id },
            sceneId: 'scene-2',
            startMs: 4000,
            durationMs: 3000,
            trimStartMs: 0,
            trimEndMs: 3000,
            sourceDurationMs: 10000,
            params: { speed: 1.25, stabilization: true },
          },
        ],
      },
      {
        id: 'track-caption',
        kind: 'caption',
        name: 'Captions',
        muted: false,
        locked: false,
        order: 10,
        clips: [
          {
            id: 'caption-one',
            kind: 'caption',
            name: 'Caption one',
            sourceRef: { kind: 'scene', sceneId: 'scene-1' },
            sceneId: 'scene-1',
            startMs: 0,
            durationMs: 4000,
            trimStartMs: 0,
            trimEndMs: 4000,
            text: 'Launch now',
            tokens: [
              { id: 'token-launch', text: 'Launch', startMs: 0, endMs: 2000 },
              { id: 'token-now', text: 'now', startMs: 2000, endMs: 4000 },
            ],
            style: { fontFamily: 'Inter', fontSize: 42, color: '#ffffff' },
          },
        ],
      },
    ],
  };
}
