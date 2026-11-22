/**
 * Run one real download batch for the browser scenario.
 *
 * The Playwright spec cannot call the agent loop, so this fixture performs the
 * two server steps that turn a question answer into files: it records the
 * destination question, claims the grant with the same answer label the card
 * submits, and runs the real runner against a fake `yt-dlp`. The fake binary
 * copies a small licensed clip into the staging folder and speaks the same
 * stdout protocol as the real tool, so the grant checks, publication and asset
 * registration are the production ones.
 *
 * Run with cwd `src-api` so tsx resolves the `@/` aliases, e.g.
 * `node --import tsx <this file>` with `MEDIA_DOWNLOAD_FIXTURE` set to a JSON
 * config. The last stdout line is `NDFIXTURE:<json>`.
 */

import { closeDatabase } from '@/shared/db';
import { createSession, createTask, getTask } from '@/shared/db/operations';
import { registerDownloadAsset } from '@/shared/services/media-download/assets';
import { resolveDownloadDestination } from '@/shared/services/media-download/downloader';
import {
  claimDownloadDestination,
  requestDownloadDestination,
} from '@/shared/services/media-download/requests';
import { runDownloadMedia } from '@/shared/services/media-download/runner';
import { directRuntime } from '@/shared/services/media-download/runtime';

interface FixtureConfig {
  taskId: string;
  sessionId: string;
  workDir: string;
  binary: string;
  urls: string[];
  mode: 'ok' | 'cancel';
}

function config(): FixtureConfig {
  const raw = process.env.MEDIA_DOWNLOAD_FIXTURE;
  if (!raw) throw new Error('MEDIA_DOWNLOAD_FIXTURE is not set');
  return JSON.parse(raw) as FixtureConfig;
}

async function main() {
  const input = config();
  closeDatabase();
  if (!getTask(input.taskId)) {
    createSession({ id: input.sessionId, prompt: 'media download fixture' });
    createTask({
      id: input.taskId,
      session_id: input.sessionId,
      task_index: 0,
      prompt: 'download two videos',
      work_dir: input.workDir,
    });
  }

  const asked = requestDownloadDestination(
    {
      taskId: input.taskId,
      sessionId: input.sessionId,
      runId: 'run-ask',
      toolCallId: 'call-download',
      batchId: 'batch-download',
    },
    { urls: input.urls },
    'en',
  );

  // The card submits the option label, so the fixture answers the same way.
  const claim = claimDownloadDestination(
    input.taskId,
    asked.questionId,
    'Task folder',
    'run-download',
  );
  if (!claim.ok) {
    process.stdout.write(`NDFIXTURE:${JSON.stringify({ claim })}\n`);
    return;
  }

  const activities: unknown[] = [];
  const controller = new AbortController();
  if (input.mode === 'cancel') {
    // Let the fake process start, then cancel the batch while it runs.
    setTimeout(() => controller.abort(), 300);
  }
  const activity = await runDownloadMedia(claim.value.operation, {
    signal: controller.signal,
    resolveDestination: resolveDownloadDestination,
    registerAsset: (operation, itemId, root, file) =>
      registerDownloadAsset(operation, itemId, root, file),
    emit: (snapshot) => activities.push(snapshot),
    runtime: directRuntime(input.binary),
  });

  process.stdout.write(
    `NDFIXTURE:${JSON.stringify({
      question: asked.question,
      questionId: asked.questionId,
      grantId: asked.grantId,
      activity,
      activities,
      destination: claim.value.grant.directory,
    })}\n`,
  );
}
main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(
      `fixture failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  },
);
