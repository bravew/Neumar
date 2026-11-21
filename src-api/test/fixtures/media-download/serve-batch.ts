/**
 * A model-free browser fixture with live downloads. Only the model source is
 * replaced: question validation, detached AG-UI transport, persisted history,
 * the Stop route and process cancellation use production code.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { serve } from '@hono/node-server';
import type { DownloadActivity } from '@neumar/video-ir';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';

import { aguiRoutes } from '@/app/api/ag-ui';

import type { AgentMessage } from '@/core/agent/types';

import { closeDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  getFilesByTaskId,
} from '@/shared/db/operations';
import { startDetachedAGUIRun } from '@/shared/services/ag-ui/detached-run';
import { AGUIEmitter } from '@/shared/services/ag-ui/emitter';
import { AGUIEventPersister } from '@/shared/services/ag-ui/persistence';
import {
  answerQuestionOnce,
  resolveQuestionResume,
} from '@/shared/services/ag-ui/question-decisions';
import { subscribeSSEToBus } from '@/shared/services/ag-ui/transport';
import { registerDownloadAsset } from '@/shared/services/media-download/assets';
import { resolveDownloadDestination } from '@/shared/services/media-download/downloader';
import {
  claimDownloadDestination,
  DOWNLOAD_DESTINATION_QUESTION,
  requestDownloadDestination,
} from '@/shared/services/media-download/requests';
import { withDownloadBatch } from '@/shared/services/media-download/run-batch';
import { runDownloadMedia } from '@/shared/services/media-download/runner';
import { directRuntime } from '@/shared/services/media-download/runtime';

if (!process.env.NEUMAR_APP_DATA_DIR) {
  throw new Error(
    'The browser fixture requires an isolated NEUMAR_APP_DATA_DIR',
  );
}

const input = z
  .object({
    taskId: z.string(),
    sessionId: z.string(),
    workDir: z.string(),
    binary: z.string(),
    urls: z.array(z.string()),
  })
  .parse(JSON.parse(process.env.MEDIA_DOWNLOAD_FIXTURE ?? 'null'));
const requestSchema = z.object({
  resume: z.array(
    z.object({
      interruptId: z.string(),
      status: z.enum(['resolved', 'cancelled']),
      payload: z.unknown().optional(),
    }),
  ),
  messages: z.array(
    z.object({ role: z.string(), content: z.unknown().optional() }),
  ),
});

createSession({ id: input.sessionId, prompt: 'download fixture' });
createTask({
  id: input.taskId,
  session_id: input.sessionId,
  task_index: 0,
  prompt: 'download a video',
  work_dir: input.workDir,
});
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

let activity: DownloadActivity | undefined;
let controller: AbortController | undefined;
let running: Promise<void> | undefined;
let stopped = false;
const destination = path.join(input.workDir, 'output');
const app = new Hono();
app.use('*', cors());
app.get('/state', (c) =>
  c.json({
    activity,
    stopped,
    destination,
    questionId: asked.questionId,
    files: getFilesByTaskId(input.taskId),
    outputFiles: activity ? readdirSync(destination) : [],
  }),
);
app.post('/run', async (c) => {
  const parsed = requestSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const last = [...parsed.data.messages]
    .reverse()
    .find((message) => message.role === 'user');
  const decision = resolveQuestionResume({
    taskId: input.taskId,
    entries: parsed.data.resume,
    lastUserText: typeof last?.content === 'string' ? last.content : '',
  });
  if (decision.kind !== 'answer') return c.json({ error: decision }, 409);
  const runId = crypto.randomUUID();
  const claim = claimDownloadDestination(
    input.taskId,
    decision.questionId,
    decision.answers[DOWNLOAD_DESTINATION_QUESTION] ?? '',
    runId,
  );
  if (!claim.ok) return c.json({ error: claim.message }, 409);
  const recorded = answerQuestionOnce(decision.questionId, decision.answers);
  if (!recorded.ok) return c.json({ error: recorded.message }, 409);

  controller = new AbortController();
  controller.signal.addEventListener(
    'abort',
    () => {
      stopped = true;
    },
    { once: true },
  );
  async function* model(): AsyncGenerator<AgentMessage> {
    yield { type: 'done' };
  }
  const source = withDownloadBatch(
    model(),
    claim.value.operation,
    (operation, options) =>
      runDownloadMedia(operation, {
        ...options,
        resolveDestination: resolveDownloadDestination,
        registerAsset: registerDownloadAsset,
        runtime: directRuntime(input.binary),
        emit: (snapshot) => {
          activity = snapshot;
          options.emit(snapshot);
        },
      }),
    controller.signal,
  );
  const emitter = new AGUIEmitter(input.taskId, runId, {
    taskId: input.taskId,
    workspaceRoot: input.workDir,
    signal: controller.signal,
  });
  const busKey = `fixture:${input.taskId}:${runId}`;
  running = startDetachedAGUIRun({
    mode: 'task',
    ownerKey: input.taskId,
    runId,
    threadId: input.taskId,
    busKey,
    controller,
    events: emitter.transform(source),
    persister: new AGUIEventPersister(input.taskId, runId, input.workDir),
  });
  return streamSSE(c, (stream) =>
    subscribeSSEToBus(
      stream,
      busKey,
      c.req.header('Accept') ?? '',
      c.req.raw.signal,
    ),
  );
});
// In particular, /ag-ui/stop/:taskId below is the actual production route.
app.route('/ag-ui', aguiRoutes);
const server = serve(
  { fetch: app.fetch, port: 0, hostname: '127.0.0.1' },
  (address) => {
    process.stdout.write(
      `NDREADY:${JSON.stringify({ origin: `http://127.0.0.1:${address.port}`, questionId: asked.questionId, destination })}\n`,
    );
  },
);
process.once('SIGTERM', () => {
  controller?.abort();
  void Promise.resolve(running).finally(() => {
    server.close();
    closeDatabase();
    process.exit(0);
  });
});
