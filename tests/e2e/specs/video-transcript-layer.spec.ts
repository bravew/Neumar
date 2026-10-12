import { test, expect, type APIRequestContext } from '../fixtures/base';

import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Interactive Transcript Layer acceptance (T8).
 *
 * Drives the whole flow the plan specifies — analyze → select words → cut →
 * undo → restore → text-only delete — against the API's public routes, and
 * asserts the browser reflects each state. The transcript is seeded into the
 * source's analysis cache instead of being transcribed, so the run is
 * deterministic and needs no ASR provider or network.
 *
 * The seed path is discovered rather than derived: the first `analyze` writes a
 * real (degraded, zero-word) transcript artifact whose `cachePath` names the
 * exact file the analyzer reads. Overwriting that file with the fixture
 * transcript and analyzing again makes the analyzer pick it up as a cache hit,
 * exactly as a real transcription would. That keeps the spec independent of the
 * workspace root, which the API resolves from settings or its own cwd.
 */

const API_BASE = 'http://127.0.0.1:5126';
const FIXTURE_PATH = path.join(
  process.cwd(),
  'tests/e2e/fixtures/video/transcript/transcript-source.mp4',
);

/** The fixture's real media duration, in ms (see its generate.py). */
const MEDIA_DURATION_MS = 12_000;

/** Source-time words, back to back, spanning the fixture's speech bed. */
const WORDS = [
  { text: 'This', startMs: 0, endMs: 400 },
  { text: 'product', startMs: 400, endMs: 900 },
  { text: 'lets', startMs: 900, endMs: 1200 },
  { text: 'you', startMs: 1200, endMs: 1400 },
  { text: 'ship', startMs: 1400, endMs: 1900 },
  { text: 'faster', startMs: 1900, endMs: 2500 },
  { text: 'with', startMs: 2500, endMs: 2800 },
  { text: 'less', startMs: 2800, endMs: 3100 },
  { text: 'effort', startMs: 3100, endMs: 3800 },
  { text: 'overall', startMs: 3800, endMs: 4600 },
];

/** Cuts words 2..6 — "lets you ship faster with" — i.e. source [900, 2800). */
const CUT_START_INDEX = 2;
const CUT_END_INDEX = 6;
const CUT_SOURCE_START_MS = WORDS[CUT_START_INDEX]!.startMs;
const CUT_SOURCE_END_MS = WORDS[CUT_END_INDEX]!.endMs;
const SELECTED_WORD_COUNT = CUT_END_INDEX - CUT_START_INDEX + 1;

const LINK_GROUP = 'group-speech';

/** Projects created by a test, deleted in `afterEach`. */
const created: string[] = [];

interface Fixture {
  projectId: string;
  sourceId: string;
  assetId: string;
}

type TimelineClipRecord = {
  id: string;
  kind: string;
  sourceRef: Record<string, string>;
  linkGroupId?: string;
  startMs: number;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  text?: string;
  words?: Array<{ text: string; startMs: number; endMs: number }>;
};

type TimelineTrackRecord = {
  id: string;
  kind: string;
  clips: TimelineClipRecord[];
};

type VideoProjectRecord = {
  id: string;
  revision: number;
  sources: Array<{ id: string; mediaItemId: string; contentHash: string }>;
  assets: Array<{ id: string; path: string }>;
  sourceAnalyses: Array<{
    sourceId: string;
    transcript?: { words?: Array<{ text: string }> };
  }>;
  analysisArtifacts: Array<{
    kind: string;
    sourceMediaId?: string;
    cachePath?: string;
  }>;
  timeline?: {
    schema: string;
    fps: number;
    durationMs: number;
    tracks: TimelineTrackRecord[];
  };
};

test.describe('Interactive transcript layer', () => {
  test.setTimeout(180_000);

  test.afterEach(async ({ request }) => {
    while (created.length > 0) {
      const id = created.pop();
      if (id) {
        await request
          .delete(`${API_BASE}/video/projects/${id}`)
          .catch(() => {});
      }
    }
  });

  test('analyze, cut words from the media, undo, restore, then delete text only', async ({
    page,
    request,
  }) => {
    const fixture = await setupAnalyzedProject(request);

    await page.goto(`/video/${fixture.projectId}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('Something went wrong')).not.toBeVisible();

    // The preview step recommends the transcript rail tab; the speech pane is
    // its default pane once an analyzed source has word timings.
    const speechPanel = page.getByRole('group', { name: 'Speech' });
    await expect(speechPanel).toBeVisible({ timeout: 30_000 });

    const wordButtons = speechPanel.locator('button[data-word-index]');
    await expect(wordButtons).toHaveCount(WORDS.length);
    await expect(speechPanel.getByText('This', { exact: true })).toBeVisible();

    // --- Select a word range: click, then shift-click extends it ---
    await wordButtons.nth(CUT_START_INDEX).click();
    await wordButtons.nth(CUT_END_INDEX).click({ modifiers: ['Shift'] });
    await expect(
      speechPanel.locator('button[data-word-index][aria-pressed="true"]'),
    ).toHaveCount(SELECTED_WORD_COUNT);
    await expect(
      speechPanel.getByText(`${SELECTED_WORD_COUNT} words selected`),
    ).toBeVisible();

    // --- Cut in Cut-media mode: video, audio and the linked caption all change
    await speechPanel.getByRole('button', { name: 'Cut media' }).click();
    await speechPanel.getByRole('button', { name: 'Cut', exact: true }).click();

    await expect
      .poll(() => speechPanel.locator('button[data-status="cut"]').count(), {
        timeout: 20_000,
      })
      .toBe(SELECTED_WORD_COUNT);

    // Cut words stay visible, struck through, and restorable.
    await expect(
      speechPanel.locator('button[data-status="cut"]').first(),
    ).toHaveClass(/line-through/);

    // The editor autosaves on a debounce, so read the saved project through a
    // poll rather than racing the write.
    await expect
      .poll(
        async () =>
          videoClipSpans(await getProject(request, fixture.projectId)),
        {
          timeout: 20_000,
        },
      )
      .toEqual([
        [0, CUT_SOURCE_START_MS, 0, CUT_SOURCE_START_MS],
        [
          CUT_SOURCE_START_MS,
          MEDIA_DURATION_MS - CUT_SOURCE_END_MS,
          CUT_SOURCE_END_MS,
          MEDIA_DURATION_MS,
        ],
      ]);
    const cut = await getProject(request, fixture.projectId);
    // Audio moved with the video…
    const cutAudio = clipsOfKind(cut, 'audio-vo');
    expect(cutAudio.map((clip) => [clip.startMs, clip.durationMs])).toEqual(
      videoClips(cut).map((clip) => [clip.startMs, clip.durationMs]),
    );
    // …and the caption lost exactly the cut words' text.
    const cutCaption = clipsOfKind(cut, 'caption');
    expect(cutCaption[0]!.text).toBe('This product');
    expect(cutCaption[1]!.text).toBe('less effort overall');

    // --- Undo returns the editor to the pre-cut state ---
    await undo(page);
    await expect
      .poll(() => speechPanel.locator('button[data-status="cut"]').count(), {
        timeout: 20_000,
      })
      .toBe(0);
    await expect
      .poll(
        async () =>
          videoClipSpans(await getProject(request, fixture.projectId)),
        {
          timeout: 20_000,
        },
      )
      .toEqual([[0, MEDIA_DURATION_MS, 0, MEDIA_DURATION_MS]]);
    expect(
      clipsOfKind(await getProject(request, fixture.projectId), 'caption')[0]!
        .text,
    ).toBe(WORDS.map((word) => word.text).join(' '));

    // --- Restore: cut the same range, then restore it from the panel ---
    await wordButtons.nth(CUT_START_INDEX).click();
    await wordButtons.nth(CUT_END_INDEX).click({ modifiers: ['Shift'] });
    await speechPanel.getByRole('button', { name: 'Cut', exact: true }).click();
    await expect
      .poll(() => speechPanel.locator('button[data-status="cut"]').count(), {
        timeout: 20_000,
      })
      .toBe(SELECTED_WORD_COUNT);

    await speechPanel.getByRole('button', { name: 'Restore' }).click();
    await expect
      .poll(() => speechPanel.locator('button[data-status="cut"]').count(), {
        timeout: 20_000,
      })
      .toBe(0);

    // The seam fragment is extended back over the removed span, so the pair
    // tiles the source again and the caption text returns in full.
    await expect
      .poll(
        async () =>
          videoClipSpans(await getProject(request, fixture.projectId)),
        {
          timeout: 20_000,
        },
      )
      .toEqual([
        [0, CUT_SOURCE_END_MS, 0, CUT_SOURCE_END_MS],
        [
          CUT_SOURCE_END_MS,
          MEDIA_DURATION_MS - CUT_SOURCE_END_MS,
          CUT_SOURCE_END_MS,
          MEDIA_DURATION_MS,
        ],
      ]);
    await expect
      .poll(
        async () =>
          clipsOfKind(
            await getProject(request, fixture.projectId),
            'caption',
          )[0]?.text,
        { timeout: 20_000 },
      )
      .toBe('This product lets you ship faster with');

    // --- Text mode: Delete changes only the word's text, never the media ---
    await speechPanel
      .getByRole('button', { name: 'Text', exact: true })
      .click();
    await wordButtons.first().click();
    await page.keyboard.press('Delete');

    await expect
      .poll(
        async () => {
          const project = await getProject(request, fixture.projectId);
          return project.sourceAnalyses.find(
            (analysis) => analysis.sourceId === fixture.sourceId,
          )?.transcript?.words?.[0]?.text;
        },
        { timeout: 20_000 },
      )
      .toBe('');

    // The media is untouched by a text-only delete.
    expect(
      videoClipSpans(await getProject(request, fixture.projectId)),
    ).toEqual([
      [0, CUT_SOURCE_END_MS, 0, CUT_SOURCE_END_MS],
      [
        CUT_SOURCE_END_MS,
        MEDIA_DURATION_MS - CUT_SOURCE_END_MS,
        CUT_SOURCE_END_MS,
        MEDIA_DURATION_MS,
      ],
    ]);
  });
});

function videoClips(project: VideoProjectRecord): TimelineClipRecord[] {
  return clipsOfKind(project, 'video');
}

/** `[startMs, durationMs, trimStartMs, trimEndMs]` for every video clip. */
function videoClipSpans(project: VideoProjectRecord): number[][] {
  return videoClips(project).map((clip) => [
    clip.startMs,
    clip.durationMs,
    clip.trimStartMs,
    clip.trimEndMs,
  ]);
}

function clipsOfKind(
  project: VideoProjectRecord,
  kind: string,
): TimelineClipRecord[] {
  const track = project.timeline?.tracks.find((item) => item.kind === kind);
  expect(track, `the ${kind} track should be on the timeline`).toBeTruthy();
  return track!.clips;
}

async function getProject(
  request: APIRequestContext,
  projectId: string,
): Promise<VideoProjectRecord> {
  const response = await request.get(`${API_BASE}/video/projects/${projectId}`);
  expect(response.ok()).toBeTruthy();
  const { project } = (await response.json()) as {
    project: VideoProjectRecord;
  };
  return project;
}

/** Click a word and Cmd/Ctrl+Z, matching the editor's document-global undo. */
async function undo(page: import('@playwright/test').Page): Promise<void> {
  const isMac = await page.evaluate(() =>
    /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent),
  );
  await page.keyboard.press(`${isMac ? 'Meta' : 'Control'}+z`);
}

/**
 * Create a project, import the fixture, seed its transcript cache, and put a
 * video + audio + linked-caption timeline on it. Returns the ids the assertions
 * and the cleanup need.
 */
async function setupAnalyzedProject(
  request: APIRequestContext,
): Promise<Fixture> {
  const createResponse = await request.post(`${API_BASE}/video/projects`, {
    data: {
      name: `Transcript e2e ${crypto.randomUUID()}`,
      template: 'explainer',
      aspectRatio: '16:9',
    },
  });
  expect(createResponse.ok()).toBeTruthy();
  const { project } = (await createResponse.json()) as {
    project: VideoProjectRecord;
  };
  created.push(project.id);

  const buffer = await fs.readFile(FIXTURE_PATH);
  const importResponse = await request.post(
    `${API_BASE}/video/projects/${project.id}/sources/import`,
    {
      multipart: {
        file: { name: 'transcript-source.mp4', mimeType: 'video/mp4', buffer },
      },
    },
  );
  expect(importResponse.ok()).toBeTruthy();
  const imported = (await importResponse.json()) as {
    project: VideoProjectRecord;
    source: { id: string };
    asset: { id: string };
  };
  const sourceId = imported.source.id;
  const assetId = imported.asset.id;

  // First analyze: no cache entry yet, so the analyzer writes a real (here
  // word-less) transcript artifact that names the exact cache file it reads.
  const firstAnalyze = await request.post(
    `${API_BASE}/video/projects/${project.id}/sources/${sourceId}/analyze`,
  );
  expect(firstAnalyze.ok()).toBeTruthy();
  const { project: analyzed } = (await firstAnalyze.json()) as {
    project: VideoProjectRecord;
  };
  const cachePath = analyzed.analysisArtifacts.find(
    (artifact) =>
      artifact.kind === 'transcript-ranges' &&
      artifact.sourceMediaId === sourceId,
  )?.cachePath;
  expect(
    cachePath,
    'analyze should record where the transcript cache lives',
  ).toBeTruthy();

  await fs.writeFile(
    cachePath!,
    `${JSON.stringify(seedEntry(sourceId), null, 2)}\n`,
  );

  // Second analyze: the seeded entry is a valid cache hit, so the panel gets
  // the fixture transcript without an ASR provider.
  const secondAnalyze = await request.post(
    `${API_BASE}/video/projects/${project.id}/sources/${sourceId}/analyze`,
  );
  expect(secondAnalyze.ok()).toBeTruthy();
  const { project: seeded } = (await secondAnalyze.json()) as {
    project: VideoProjectRecord;
  };
  expect(
    seeded.sourceAnalyses.find((analysis) => analysis.sourceId === sourceId)
      ?.transcript?.words?.length,
  ).toBe(WORDS.length);

  const timeline = buildTimeline(assetId);
  const patchResponse = await request.patch(
    `${API_BASE}/video/projects/${project.id}/timeline`,
    { data: { timeline } },
  );
  expect(patchResponse.ok()).toBeTruthy();

  return { projectId: project.id, sourceId, assetId };
}

/** The transcript-cache entry shape `readTranscriptCache` accepts. */
function seedEntry(sourceId: string) {
  const text = WORDS.map((word) => word.text).join(' ');
  return {
    transcript: {
      engine: 'local:seeded',
      words: WORDS,
      segments: [
        { id: 'segment-1', text, startMs: 0, endMs: MEDIA_DURATION_MS },
      ],
    },
    artifact: {
      id: `artifact-transcript-${sourceId}`,
      kind: 'transcript-ranges',
      sourceMediaId: sourceId,
      summary: `${WORDS.length} word-level transcript ranges available.`,
      ranges: WORDS.map((word, index) => ({
        id: `${sourceId}:w${index + 1}`,
        startMs: word.startMs,
        endMs: word.endMs,
        label: word.text,
      })),
      metadata: {
        provider: 'Local',
        model: 'seeded',
        dataEgress: 'local',
        estimatedCostCents: 0,
        degraded: false,
        wordTimestampsAvailable: true,
        wordCount: WORDS.length,
        segmentCount: 1,
      },
      generatedAt: new Date().toISOString(),
    },
    provider: 'Local',
    providerKey: 'local',
    model: 'seeded',
    dataEgress: 'local',
    degraded: false,
    estimatedCostCents: 0,
  };
}

/**
 * One source clip on the video track, a linked audio clip, and a caption cue in
 * the same link group carrying the word timings — the shape the transcript
 * compilers ripple across.
 */
function buildTimeline(
  assetId: string,
): NonNullable<VideoProjectRecord['timeline']> {
  const base = {
    sourceRef: { kind: 'asset', assetId },
    startMs: 0,
    durationMs: MEDIA_DURATION_MS,
    trimStartMs: 0,
    trimEndMs: MEDIA_DURATION_MS,
  };
  return {
    schema: 'neuma.video.timeline.v1',
    fps: 24,
    durationMs: MEDIA_DURATION_MS,
    tracks: [
      {
        id: 'track-video',
        kind: 'video',
        clips: [{ id: 'clip-video', kind: 'video', ...base }],
      },
      {
        id: 'track-audio',
        kind: 'audio-vo',
        clips: [
          {
            id: 'clip-audio',
            kind: 'audio',
            linkGroupId: LINK_GROUP,
            ...base,
          },
        ],
      },
      {
        id: 'track-caption',
        kind: 'caption',
        clips: [
          {
            id: 'clip-caption',
            kind: 'caption',
            linkGroupId: LINK_GROUP,
            text: WORDS.map((word) => word.text).join(' '),
            words: WORDS,
            tokens: WORDS.map((word, index) => ({
              ...word,
              id: `token-${index}`,
            })),
            ...base,
          },
        ],
      },
    ],
  };
}
