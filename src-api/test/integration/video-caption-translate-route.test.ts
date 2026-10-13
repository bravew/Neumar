import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@/shared/db', () => ({
  getDatabase: () => ({
    prepare: () => ({ get: () => undefined, run: () => undefined }),
  }),
}));
vi.mock('@/shared/db/operations', () => ({ getSetting: () => undefined }));
// Translation now runs through the Claude Code runtime (the current Video-mode
// model), not a raw fetch. Mock the SDK query so the route can be exercised
// without spawning the CLI.
vi.mock('@anthropic-ai/claude-agent-sdk/core', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@anthropic-ai/claude-agent-sdk/core')
    >();
  return { ...actual, query: queryMock };
});

import { videoRoutes } from '@/app/api/video';

import { getProject, writeProject } from '@/shared/video/store';
import type { VideoProject } from '@/shared/video/types';

let workDir: string;

const CAPTION_TRACK = {
  id: 'track-caption-main',
  kind: 'caption' as const,
  name: 'Captions',
  language: 'en',
  muted: false,
  locked: false,
  order: 30,
  clips: [
    {
      id: 'cap-1',
      kind: 'caption' as const,
      sourceRef: { kind: 'asset' as const, assetId: 'asset' },
      startMs: 0,
      durationMs: 1000,
      trimStartMs: 0,
      trimEndMs: 1000,
      text: 'hello world',
    },
    {
      id: 'cap-2',
      kind: 'caption' as const,
      sourceRef: { kind: 'asset' as const, assetId: 'asset' },
      startMs: 1000,
      durationMs: 1000,
      trimStartMs: 1000,
      trimEndMs: 2000,
      text: 'second line',
    },
  ],
};

function projectFixture(over: Partial<VideoProject> = {}): VideoProject {
  return {
    schemaVersion: 2,
    revision: 1,
    id: 'caption-translate-route',
    name: 'Video',
    template: 'explainer',
    assets: [],
    budget: { capUsd: 5, spentUsd: 0 },
    sources: [],
    sourceAnalyses: [],
    timeline: {
      schema: 'neuma.video.timeline.v1',
      fps: 30,
      durationMs: 2000,
      tracks: [structuredClone(CAPTION_TRACK)],
    },
    ...over,
  } as unknown as VideoProject;
}

/** A successful single-turn SDK query answering with the given result text. */
function claudeResult(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'result', subtype: 'success', result: text };
    },
    close: vi.fn(),
  };
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'caption-translate-route-'),
  );
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('ANTHROPIC_BASE_URL', '');
  queryMock.mockReset();
  queryMock.mockImplementation(() =>
    claudeResult('[{"i":0,"text":"hola"},{"i":1,"text":"segunda"}]'),
  );
  await writeProject(projectFixture(), { snapshot: false });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await fs.rm(workDir, { recursive: true, force: true });
});

function translate(body: Record<string, unknown>) {
  return videoRoutes.request(
    `/projects/${'caption-translate-route'}/captions/translate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

describe('caption translation route', () => {
  it('reports the actual destination without exposing credentials', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://proxy.example/v1');
    const response = await videoRoutes.request(
      '/caption-translation/destination',
    );
    expect(await response.json()).toEqual({
      destination: 'https://proxy.example',
      configured: true,
    });
  });

  it('rejects confirmation for a different destination before sending text', async () => {
    const response = await translate({
      targetLanguage: 'es',
      egressConfirmed: true,
      consentDestination: 'https://other.example',
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'cloud-egress-consent-required',
    });
    expect(
      (await getProject('caption-translate-route')).settings
        ?.captionTranslationEgressConsents,
    ).toBeUndefined();
  });

  it('refuses to translate before the egress consent is given', async () => {
    const response = await translate({ targetLanguage: 'es' });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'cloud-egress-consent-required',
    });
  });

  it('rejects a language the action does not support', async () => {
    const response = await translate({
      targetLanguage: 'de',
      egressConfirmed: true,
    });
    expect(response.status).toBe(400);
  });

  it('reports a missing caption track rather than translating nothing', async () => {
    await writeProject(
      projectFixture({
        timeline: {
          schema: 'neuma.video.timeline.v1',
          fps: 30,
          durationMs: 2000,
          tracks: [],
        },
      } as Partial<VideoProject>),
      { snapshot: false },
    );
    const response = await translate({
      targetLanguage: 'es',
      egressConfirmed: true,
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'no-caption-track' });
  });

  it('persists the first-time consent so the user is asked once per provider', async () => {
    await translate({
      targetLanguage: 'es',
      consentDestination: 'https://api.anthropic.com',
      egressConfirmed: true,
    });
    const stored = await getProject('caption-translate-route');
    expect(
      stored.settings?.captionTranslationEgressConsents?.[
        'https://api.anthropic.com'
      ],
    ).toMatchObject({ confirmed: true });
  });

  it('stores a hidden translation with unique cue IDs and no budget debit', async () => {
    const response = await translate({
      targetLanguage: 'es',
      egressConfirmed: true,
      consentDestination: 'https://api.anthropic.com',
    });
    expect(response.status).toBe(200);
    const stored = await getProject('caption-translate-route');
    const track = stored.timeline?.tracks.find(
      (item) => item.id === 'track-caption-es',
    );
    expect(track).toMatchObject({ hidden: true, language: 'es' });
    expect(track?.clips.map((clip) => clip.id)).toEqual([
      'track-caption-es:cap-1',
      'track-caption-es:cap-2',
    ]);
    // Cost is intentionally not tracked for translation.
    expect(stored.budget?.spentUsd).toBe(0);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('preserves transcription and translation consent settings through PATCH', async () => {
    const settings = {
      sourceTranscriptionProviderId: 'cloud',
      sourceTranscriptionEgressConsents: {
        cloud: { confirmed: true, confirmedAt: '2026-10-12' },
      },
      captionTranslationProviderId: 'https://api.anthropic.com',
      captionTranslationEgressConsents: {
        'https://api.anthropic.com': {
          confirmed: true,
          confirmedAt: '2026-10-12',
        },
      },
    };
    const response = await videoRoutes.request(
      '/projects/caption-translate-route/settings',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      },
    );
    expect(response.status).toBe(200);
    expect(
      (await getProject('caption-translate-route')).settings,
    ).toMatchObject(settings);
  });

  it('preserves typed consent errors on the direct agent route', async () => {
    const response = await videoRoutes.request(
      '/projects/caption-translate-route/agent/tools',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'translate', args: { lang: 'es' } }),
      },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: 'cloud-egress-consent-required',
    });
  });
});
