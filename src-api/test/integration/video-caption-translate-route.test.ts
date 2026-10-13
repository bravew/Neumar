import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/db', () => ({
  getDatabase: () => ({
    prepare: () => ({ get: () => undefined, run: () => undefined }),
  }),
}));
vi.mock('@/shared/db/operations', () => ({ getSetting: () => undefined }));

import { videoRoutes } from '@/app/api/video';

import { buildVideoCostApprovalToken } from '@/shared/video/cost-approval';
import { estimateTranslationCostCents } from '@/shared/video/cost-estimator';
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

const ESTIMATED_CENTS = estimateTranslationCostCents({
  charCount: 'hello world'.length + 'second line'.length,
});

beforeEach(async () => {
  workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'caption-translate-route-'),
  );
  vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('ANTHROPIC_BASE_URL', '');
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
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
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

  it('auto-approves a translation under the project auto-approve floor', async () => {
    const response = await translate({
      targetLanguage: 'es',
      consentDestination: 'https://api.anthropic.com',
      egressConfirmed: true,
    });
    // 1 cent is below the 25-cent default floor, so the cost gate lets it
    // through. No provider credentials are configured, so the call itself
    // fails — past both gates, which is what this asserts.
    expect(ESTIMATED_CENTS).toBeLessThan(25);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'provider-failed' });
  });

  it('asks for cost approval once the estimate clears the floor', async () => {
    await writeProject(
      projectFixture({
        settings: { autoApproveUnderCents: 1 },
      } as Partial<VideoProject>),
      { snapshot: false },
    );
    const response = await translate({
      targetLanguage: 'es',
      consentDestination: 'https://api.anthropic.com',
      egressConfirmed: true,
    });
    expect(ESTIMATED_CENTS).toBeGreaterThanOrEqual(1);
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      code: 'cost-approval-required',
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

  it('stores a hidden translation with unique cue IDs and debits its budget', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: '[{"i":0,"text":"hola"},{"i":1,"text":"segunda"}]',
              },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
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
    expect(stored.budget?.spentUsd).toBe(ESTIMATED_CENTS / 100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves unrelated edits and stores explicit cost approval for agent retries', async () => {
    await writeProject(
      projectFixture({ settings: { autoApproveUnderCents: 1 } }),
      { snapshot: false },
    );
    const first = await translate({
      targetLanguage: 'es',
      egressConfirmed: true,
      consentDestination: 'https://api.anthropic.com',
    });
    const gate = (await first.json()) as { detail: { approvalToken: string } };
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const current = await getProject('caption-translate-route');
        await writeProject(
          { ...current, name: 'Concurrent edit' },
          { snapshot: false },
        );
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: '[{"i":0,"text":"hola"},{"i":1,"text":"segunda"}]',
              },
            ],
          }),
        );
      }),
    );
    const response = await translate({
      targetLanguage: 'es',
      egressConfirmed: true,
      consentDestination: 'https://api.anthropic.com',
      costApproval: {
        token: gate.detail.approvalToken,
        approvedCents: ESTIMATED_CENTS,
        approvedBy: 'user',
      },
    });
    expect(response.status).toBe(200);
    const current = await getProject('caption-translate-route');
    expect(current.name).toBe('Concurrent edit');
    expect(
      current.settings?.captionTranslationCostApprovals?.[
        'https://api.anthropic.com'
      ]?.token,
    ).toBe(gate.detail.approvalToken);
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

  it('rejects over-budget work before contacting the provider', async () => {
    await writeProject(projectFixture({ budget: { capUsd: 0, spentUsd: 0 } }), {
      snapshot: false,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await translate({
      targetLanguage: 'es',
      egressConfirmed: true,
      consentDestination: 'https://api.anthropic.com',
    });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: 'budget-exceeded' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a saved destination-scoped cost approval before calling the provider', async () => {
    await writeProject(
      projectFixture({
        settings: {
          captionTranslationEgressConsents: {
            'https://api.anthropic.com': {
              confirmed: true,
              confirmedAt: new Date().toISOString(),
            },
          },
          captionTranslationCostApprovals: {
            'https://api.anthropic.com': {
              token: buildVideoCostApprovalToken(
                'caption-translate-route',
                `translate:caption-translate-route:track-caption-main:es:https://api.anthropic.com`,
                ESTIMATED_CENTS,
              ),
              approvedCents: ESTIMATED_CENTS,
              approvedAt: new Date().toISOString(),
              approvedBy: 'user',
            },
          },
        },
      } as Partial<VideoProject>),
      { snapshot: false },
    );

    const response = await translate({
      targetLanguage: 'es',
      consentDestination: 'https://api.anthropic.com',
    });
    // No provider credentials are configured in this test, so the call itself
    // fails — but it fails past both gates, which is what this asserts.
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'provider-failed' });
  });
});
