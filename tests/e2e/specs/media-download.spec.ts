import {
  downloadActivityId,
  MEDIA_DOWNLOAD_ACTIVITY,
  type DownloadActivity,
} from '@neumar/video-ir';
import type { Page } from '@playwright/test';

import { test, expect } from '../fixtures/base';

import { spawn } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The integrated download path (#356): the destination question, real
 * progress, playback and a failed sibling, through Task V2.
 *
 * The agent loop is mocked in the browser because a browser test cannot run a
 * model. Everything below it is real: the fixture records the question, claims
 * the grant with the same answer label the card submits, and runs the
 * production runner against a fake `yt-dlp` that copies a licensed clip into
 * the staging folder. The saved file is then served by the real API and played
 * by the real card, so the assertion that the chosen folder holds the file and
 * that playback seeks covers the same code a user reaches.
 */

const api = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:5126';
const here = import.meta.dirname;
const root = path.resolve(here, '../../..');
const fixtureScript = path.join(
  root,
  'tests/e2e/fixtures/media-download/run-batch.ts',
);
const apiCwd = path.join(root, 'src-api');
const clipFixture = path.join(
  root,
  'tests/e2e/fixtures/media/download-source.webm',
);

const QUESTION = 'Where should the videos be saved?';

/** A fake `yt-dlp` that speaks the runner's structured stdout protocol. */
const FAKE_YTDLP = `#!/bin/sh
stage=""
while [ $# -gt 0 ]; do
  case "$1" in
    -P) stage="$2"; shift 2 ;;
    --) shift; url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  *fail*) echo "ERROR: unable to download video data: HTTP Error 404" >&2; exit 1 ;;
  *slow*) sleep 30 ;;
esac
printf '%s\\n' 'NDPROGRESS:{"stream":"137","bytes":4096,"total":8192,"estimate":null,"speed":1024,"eta":4}'
printf '%s\\n' 'NDFINISH'
cp "$(dirname "$0")/clip.webm" "$stage/clip.webm"
printf 'NDFILE:%s\\n' "$stage/clip.webm"
`;

interface FixtureResult {
  activity: DownloadActivity;
  activities: DownloadActivity[];
  destination: string;
  questionId: string;
}

function fakeDownloader(dir: string): string {
  const binary = path.join(dir, 'fake-yt-dlp');
  writeFileSync(binary, FAKE_YTDLP);
  chmodSync(binary, 0o755);
  copyFileSync(clipFixture, path.join(dir, 'clip.webm'));
  return binary;
}

/** Run the real runner in a child process sharing the API's data directory. */
function runFixture(config: {
  taskId: string;
  workDir: string;
  binary: string;
  urls: string[];
  mode: 'ok' | 'cancel';
}): Promise<FixtureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fixtureScript], {
      cwd: apiCwd,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        // The fixture lives outside `src-api`; point tsx at the API tsconfig
        // so its `@/` imports resolve to the API sources.
        TSX_TSCONFIG_PATH: path.join(apiCwd, 'tsconfig.json'),
        MEDIA_DOWNLOAD_FIXTURE: JSON.stringify({
          ...config,
          sessionId: `session-${config.taskId}`,
        }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      const line = stdout
        .split('\n')
        .filter((value) => value.startsWith('NDFIXTURE:'))
        .pop();
      if (code !== 0 || !line) {
        reject(
          new Error(
            `download fixture exited ${code}: ${stderr || stdout || 'no output'}`,
          ),
        );
        return;
      }
      resolve(JSON.parse(line.slice('NDFIXTURE:'.length)) as FixtureResult);
    });
  });
}

function questionInterrupt(taskId: string, questionId: string, output: string) {
  return {
    id: `question:${questionId}`,
    reason: 'agent_question',
    message: QUESTION,
    metadata: {
      decision: {
        kind: 'question',
        taskId,
        questions: [
          {
            id: 'download-destination',
            question: QUESTION,
            header: 'Save videos',
            multiSelect: false,
            options: [
              { label: 'Task folder', description: output },
              {
                label: 'Choose another folder…',
                description: 'Pick any folder you have allowed.',
              },
            ],
          },
        ],
      },
    },
  };
}

const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

function progressStream(
  taskId: string,
  cardId: string,
  progress: DownloadActivity,
): string {
  return [
    { type: 'RUN_STARTED', threadId: taskId, runId: 'run-download' },
    {
      type: 'ACTIVITY_SNAPSHOT',
      messageId: cardId,
      activityType: MEDIA_DOWNLOAD_ACTIVITY,
      content: progress,
      replace: true,
    },
    {
      type: 'RUN_FINISHED',
      threadId: taskId,
      runId: 'run-download',
      outcome: { type: 'success' },
    },
  ]
    .map(sse)
    .join('');
}

/** Answer every API call in the browser except the real download routes. */
async function mockBackend(
  page: Page,
  options: {
    taskId: string;
    interrupt: unknown;
    history: () => unknown[];
    onRun: (body: unknown) => void;
    runBody: string;
  },
) {
  await page.route(`${api}/**`, (route) => {
    const url = route.request().url();
    if (
      url.startsWith(`${api}/files/`) ||
      url.startsWith(`${api}/downloads/`)
    ) {
      return route.continue();
    }
    if (url.includes('/subscribe') || url.includes('/automation/events')) {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
        body: '',
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '[]',
    });
  });

  await page.route(`${api}/copilotkit/agent/*/run`, async (route) => {
    options.onRun(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: options.runBody,
    });
  });

  await page.route(`${api}/copilotkit/info`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: '1.88.0',
        agents: {
          default: { name: 'default', description: '', className: 'Kt' },
        },
        audioFileTranscriptionEnabled: false,
        mode: 'sse',
        threadEndpoints: {
          list: false,
          inspect: true,
          mutations: false,
          realtimeMetadata: false,
        },
        suggestions: true,
        a2uiEnabled: false,
        openGenerativeUIEnabled: false,
        telemetryDisabled: false,
      }),
    }),
  );

  await page.route(`${api}/ag-ui/interrupts/${options.taskId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ interrupts: [options.interrupt] }),
    }),
  );

  await page.route(`${api}/ag-ui/history/${options.taskId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        messages: options.history(),
        isRunning: false,
        files: [],
      }),
    }),
  );

  await page.route(`${api}/runs/*/tree`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tree: [],
        rollup: {
          totalCostUsd: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          runCount: 0,
          runningCount: 0,
          failedCount: 0,
        },
        executions: [],
      }),
    }),
  );

  await page.route(`${api}/db/tasks/${options.taskId}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: options.taskId,
        session_id: `session-${options.taskId}`,
        task_index: 0,
        prompt: 'download two videos',
        title: 'Downloads',
        status: 'completed',
        favorite: false,
        cost: 0,
        duration: 1,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      }),
    }),
  );
}

/** Wait until the element can seek, then play and prove time advances. */
async function playAndSeek(page: Page, name: string) {
  const video = page.locator(`video[aria-label="${name}"]`);
  await expect(video).toBeVisible();
  await video.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        const media = element as HTMLVideoElement;
        if (media.readyState >= 1) resolve();
        else
          media.addEventListener('loadedmetadata', () => resolve(), {
            once: true,
          });
      }),
  );
  await video.evaluate((element) => {
    const media = element as HTMLVideoElement;
    media.currentTime = 2;
  });
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(1.9);
  const before = await video.evaluate(
    (element) => (element as HTMLVideoElement).currentTime,
  );
  await video.evaluate((element) => (element as HTMLVideoElement).play());
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).currentTime),
    )
    .toBeGreaterThan(before + 0.2);
}

test.use({
  launchOptions: {
    args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  },
});

test.describe('media download in Task V2', () => {
  test('asks where to save, shows progress, then plays the saved file beside a failure', async ({
    page,
  }) => {
    const home = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'neumar-e2e-dl-')),
    );
    try {
      const taskId = 'task-media-ok';
      const binary = fakeDownloader(home);
      const result = await runFixture({
        taskId,
        workDir: home,
        binary,
        urls: ['https://example.org/ok', 'https://example.org/fail'],
        mode: 'ok',
      });

      // The real runner wrote the licensed clip into the chosen folder, and a
      // failed sibling left nothing behind.
      expect(result.destination).toBe(realpathSync(path.join(home, 'output')));
      expect(existsSync(path.join(result.destination, 'clip.webm'))).toBe(true);
      expect(result.activity.items.map((item) => item.phase)).toEqual([
        'saved',
        'failed',
      ]);

      const cardId = downloadActivityId(result.activity);
      const progress = result.activities.find((activity) =>
        activity.items.some((item) => item.phase === 'transferring'),
      );
      expect(progress).toBeDefined();

      let history: unknown[] = [
        { id: 'user-1', role: 'user', content: 'download two videos' },
      ];
      const runBodies: unknown[] = [];
      await mockBackend(page, {
        taskId,
        interrupt: questionInterrupt(
          taskId,
          result.questionId,
          result.destination,
        ),
        history: () => history,
        onRun: (body) => runBodies.push(body),
        runBody: progressStream(taskId, cardId, progress!),
      });

      await page.goto(`/task-v2/${taskId}`);
      await page.waitForLoadState('networkidle');

      // The question is answered through the real card; the label is what the
      // server resolves to the folder.
      await expect(page.getByText(QUESTION)).toBeVisible();
      await page.getByRole('button', { name: /Task folder/ }).click();
      await page.getByRole('button', { name: 'Submit', exact: true }).click();

      await expect
        .poll(() => runBodies.length, { timeout: 10_000 })
        .toBeGreaterThan(0);
      expect(runBodies[0]).toMatchObject({
        resume: [
          {
            interruptId: `question:${result.questionId}`,
            status: 'resolved',
            payload: { answers: { [QUESTION]: 'Task folder' } },
          },
        ],
      });

      // Progress is on screen before completion: a bar, no player yet.
      const card = page.getByRole('region', { name: 'Video downloads' });
      await expect(card.getByRole('progressbar').first()).toBeVisible();
      await expect(card.locator('video')).toHaveCount(0);
      await expect(card.getByText('clip.webm')).toHaveCount(0);

      // Reload with the persisted batch: both outcomes survive, and the saved
      // file plays and seeks.
      history = [
        { id: 'user-1', role: 'user', content: 'download two videos' },
        {
          id: cardId,
          role: 'activity',
          activityType: MEDIA_DOWNLOAD_ACTIVITY,
          content: result.activity,
        },
      ];
      await page.reload();
      await page.waitForLoadState('networkidle');

      const savedCard = page.getByRole('region', { name: 'Video downloads' });
      await expect(savedCard.getByText('clip.webm')).toBeVisible();
      await expect(savedCard.getByText(/failed/i)).toBeVisible();
      await expect(savedCard.getByRole('status')).toContainText('1');
      await playAndSeek(page, 'clip.webm');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('publishes nothing when the batch is cancelled', async ({ page }) => {
    const home = realpathSync(
      mkdtempSync(path.join(tmpdir(), 'neumar-e2e-dl-')),
    );
    try {
      const taskId = 'task-media-cancel';
      const binary = fakeDownloader(home);
      const result = await runFixture({
        taskId,
        workDir: home,
        binary,
        urls: ['https://example.org/slow'],
        mode: 'cancel',
      });

      expect(result.activity.items[0]).toMatchObject({ phase: 'cancelled' });
      expect(existsSync(path.join(result.destination, 'clip.webm'))).toBe(
        false,
      );

      const cardId = downloadActivityId(result.activity);
      await mockBackend(page, {
        taskId,
        interrupt: questionInterrupt(
          taskId,
          result.questionId,
          result.destination,
        ),
        history: () => [
          { id: 'user-1', role: 'user', content: 'download two videos' },
          {
            id: cardId,
            role: 'activity',
            activityType: MEDIA_DOWNLOAD_ACTIVITY,
            content: result.activity,
          },
        ],
        onRun: () => undefined,
        runBody: '',
      });

      await page.goto(`/task-v2/${taskId}`);
      await page.waitForLoadState('networkidle');

      const card = page.getByRole('region', { name: 'Video downloads' });
      await expect(card.getByText(/cancelled/i)).toBeVisible();
      await expect(card.locator('video')).toHaveCount(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
