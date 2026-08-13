import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { adaptRunFailure } from '@/core/agent/runtime-state';

import { getDatabase } from '@/shared/db';
import { safeFetch } from '@/shared/network-policy/fetch';
import { trustedLocalPolicy } from '@/shared/network-policy/schema';
import { recordTraceEvent } from '@/shared/observability/trace';
import {
  createVideoTask,
  generateImage,
  getVideoTaskStatus,
  listCapabilities as listMediaCapabilities,
} from '@/shared/services/media-generation';
import {
  listCapabilities as listSpeechCapabilities,
  synthesize,
  synthesizeSoundEffect,
} from '@/shared/services/speech';
import { createLogger } from '@/shared/utils/logger';

import { getDesignBudgetStatus, preflightDesignBudget } from './budgets';
import {
  appendJsonl,
  appendProjectHistory,
  getProjectDir,
  readJsonFile,
  resolveProjectPath,
  writeJsonAtomic,
  writeProjectTextFile,
} from './fs';
import { renderHyperframesComposition } from './hyperframes-renderer';
import { loadMediaModelAliases, resolveMediaModel } from './media-aliases';
import { addProjectOutput, getDesignProject } from './projects';
import type { AudioKind, DesignOutput, DesignTaskRecord } from './types';

const logger = createLogger('DesignDispatcher');

export interface StartDesignMediaInput {
  projectId: string;
  surface: 'image' | 'video' | 'audio' | 'document';
  model?: string;
  output?: string;
  prompt: string;
  aspect?: string;
  lengthSeconds?: number;
  durationSeconds?: number;
  audioKind?: AudioKind;
  voice?: string;
  languageBoost?: string;
  image?: string;
  compositionDir?: string;
}

interface RuntimeTask extends DesignTaskRecord {
  providerTaskId?: string;
  providerTaskProvider?: string;
  providerTaskModel?: string;
}

const tasks = new Map<string, RuntimeTask>();
const controllers = new Map<string, AbortController>();

export async function startDesignMediaTask(
  input: StartDesignMediaInput,
): Promise<DesignTaskRecord> {
  const project = await getDesignProject(input.projectId);
  if (project.surface !== input.surface && input.surface !== 'document') {
    logger.info(
      `Cross-surface dispatch: project=${project.surface}, requested=${input.surface}`,
    );
  }
  const budgetCheck = await preflightDesignBudget(project, input);
  const now = new Date().toISOString();
  const requestedModel = input.model || project.media?.model || 'auto';
  const aliases = loadMediaModelAliases();
  const resolvedModel = resolveMediaModel(requestedModel, aliases);
  const dispatchInput = { ...input, model: resolvedModel };
  const record: RuntimeTask = {
    taskId: `dmtask_${randomUUID().slice(0, 12)}`,
    projectId: input.projectId,
    surface: input.surface,
    model: requestedModel,
    state: 'running',
    startedAt: now,
    progressLines: ['Task accepted by DesignMode dispatcher.'],
    providerError: null,
    usedStubFallback: false,
    prompt: input.prompt,
    requestedUnits: budgetCheck.requested,
    budgetCheck: {
      allowed: budgetCheck.allowed,
      severity: budgetCheck.severity,
      message: budgetCheck.message,
      used: budgetCheck.used,
      requested: budgetCheck.requested,
      remaining: budgetCheck.remaining,
    },
  };
  tasks.set(record.taskId, record);
  if (resolvedModel !== requestedModel) {
    record.progressLines.push(
      `Model alias resolved: ${requestedModel} -> ${resolvedModel}.`,
    );
  }
  await appendTaskRecord(record);
  await appendProjectHistory(input.projectId, {
    type: 'media.task.started',
    at: now,
    taskId: record.taskId,
    surface: input.surface,
    model: record.model,
  });
  upsertDesignTaskRow(record);
  recordDesignTrace(record, 'running');

  if (!budgetCheck.allowed) {
    record.state = 'failed';
    record.endedAt = now;
    record.durationMs = 0;
    record.providerError = budgetCheck.message ?? 'DesignMode budget exceeded.';
    record.progressLines.push(`WARN: ${record.providerError}`);
    upsertDesignTaskRow(record);
    await appendTaskRecord(record);
    await appendProjectHistory(input.projectId, {
      type: 'media.task.budget_blocked',
      at: now,
      taskId: record.taskId,
      budget: record.budgetCheck,
    });
    recordTraceEvent({
      taskId: record.taskId,
      kind: 'budget',
      status: 'denied',
      startedAt: Date.parse(now),
      endedAt: Date.parse(now),
      durationMs: 0,
      provider: 'design-mode',
      model: record.model,
      attrs: record.budgetCheck,
      error: record.providerError,
    });
    recordDesignTrace(record, 'error');
    return stripRuntime(record);
  }

  if (
    dispatchInput.surface === 'video' &&
    dispatchInput.model !== 'hyperframes-html'
  ) {
    void startProviderVideo(record, dispatchInput);
  } else {
    const controller = new AbortController();
    controllers.set(record.taskId, controller);
    void executeImmediateTask(record, dispatchInput, controller.signal);
  }
  return stripRuntime(record);
}

export async function waitDesignMediaTask(
  taskId: string,
  since = 0,
): Promise<{
  status: DesignTaskRecord['state'];
  task: DesignTaskRecord;
  file?: DesignOutput;
  progress: string[];
  nextSince: number;
  providerError?: string;
}> {
  const task = tasks.get(taskId);
  if (!task) throw new Error('Unknown DesignMode task');
  if (
    task.surface === 'video' &&
    task.state === 'running' &&
    task.providerTaskId
  ) {
    await pollProviderVideo(task);
  }

  const start = Date.now();
  while (task.state === 'running' && Date.now() - start < 25_000) {
    await sleep(500);
    if (task.surface === 'video' && task.providerTaskId) {
      await pollProviderVideo(task);
      break;
    }
  }
  const progress = task.progressLines.slice(since);
  return {
    status: task.state,
    task: stripRuntime(task),
    file: task.outputPath
      ? (await getDesignProject(task.projectId)).outputs.find(
          (output) => output.taskId === task.taskId,
        )
      : undefined,
    progress,
    nextSince: since + progress.length,
    providerError: task.providerError ?? undefined,
  };
}

export function listDesignMediaTasks(projectId: string): DesignTaskRecord[] {
  return [...tasks.values()]
    .filter((task) => task.projectId === projectId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map(stripRuntime);
}

export function reconcileRunningDesignMediaTasks() {
  const rows = getDatabase()
    .prepare(
      `SELECT id, project_id, prompt, title, status, started_at
       FROM tasks
       WHERE status = 'running'
         AND title LIKE 'DesignMode %'
         AND project_id IS NOT NULL`,
    )
    .all() as Array<{
    id: string;
    project_id: string;
    prompt: string;
    title: string;
    started_at: string | null;
  }>;
  const endedAt = new Date().toISOString();
  for (const row of rows) {
    getDatabase()
      .prepare(
        `UPDATE tasks
         SET status = 'failed', updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(row.id);
    const surface = row.title.replace(/^DesignMode\s+/, '') || 'document';
    const record: RuntimeTask = {
      taskId: row.id,
      projectId: row.project_id,
      surface: surface as RuntimeTask['surface'],
      model: 'auto',
      state: 'failed',
      startedAt: row.started_at ?? endedAt,
      endedAt,
      progressLines: [
        'Task marked failed because the daemon restarted before completion.',
      ],
      providerError: 'daemon_restart',
      usedStubFallback: false,
      prompt: row.prompt,
    };
    tasks.set(row.id, record);
    void appendTaskRecord(record).catch((error) => {
      logger.warn(`Failed to journal recovered media task ${row.id}`, error);
    });
  }
  return rows.length;
}

export async function cancelDesignMediaTask(
  taskId: string,
): Promise<DesignTaskRecord> {
  const task = tasks.get(taskId);
  if (!task) throw new Error('Unknown DesignMode task');
  controllers.get(taskId)?.abort();
  task.state = 'cancelled';
  task.endedAt = new Date().toISOString();
  task.durationMs = Date.now() - Date.parse(task.startedAt);
  task.progressLines.push('Task cancelled.');
  upsertDesignTaskRow(task);
  await appendTaskRecord(task);
  await appendProjectHistory(task.projectId, {
    type: 'media.task.cancelled',
    at: task.endedAt,
    taskId,
  });
  recordDesignTrace(task, 'cancelled');
  return stripRuntime(task);
}

export function getDesignCapabilities() {
  const media = listMediaCapabilities();
  const speech = listSpeechCapabilities();
  return {
    image: capabilityList(
      media.imageProviders,
      media.providerDetails.flatMap((p) => p.imageModels),
    ),
    video: capabilityList(
      media.videoProviders,
      media.providerDetails.flatMap((p) => p.videoModels),
    ),
    audio: capabilityList(
      [...speech.ttsProviders, ...speech.sfxProviders],
      [
        'gpt-4o-mini-tts',
        'elevenlabs-speech',
        'elevenlabs-sfx',
        'senseaudio-tts',
      ],
    ),
    speech,
    media,
  };
}

export { getDesignBudgetStatus };

async function executeImmediateTask(
  task: RuntimeTask,
  input: StartDesignMediaInput,
  signal: AbortSignal,
) {
  try {
    if (signal.aborted) throw new Error('Task cancelled');
    if (input.surface === 'document') {
      await completeDocumentTask(task, input);
    } else if (input.surface === 'image') {
      await completeImageTask(task, input);
    } else if (input.surface === 'audio') {
      await completeAudioTask(task, input);
    } else if (
      input.surface === 'video' &&
      input.model === 'hyperframes-html'
    ) {
      await completeHyperframesTask(task, input);
    }
  } catch (error) {
    failTask(task, error);
  } finally {
    controllers.delete(task.taskId);
    await appendTaskRecord(task);
  }
}

async function startProviderVideo(
  task: RuntimeTask,
  input: StartDesignMediaInput,
) {
  try {
    const projectDir = getProjectDir(input.projectId);
    const referenceImageUrl = input.image
      ? await projectImageToDataUri(input.projectId, input.image)
      : undefined;
    const result = await createVideoTask({
      prompt: input.prompt,
      workDir: path.join(projectDir, 'assets/generated'),
      aspectRatio: input.aspect,
      duration: input.lengthSeconds,
      model: input.model,
      referenceImageUrl,
    });
    if (!result.success) {
      throw new Error(result.error ?? 'Video provider rejected the task');
    }
    task.providerTaskId = result.taskId;
    task.providerTaskProvider = result.provider;
    task.providerTaskModel = result.model;
    task.progressLines.push(
      `Provider task ${result.taskId} accepted by ${result.provider}.`,
    );
    await appendTaskRecord(task);
  } catch (error) {
    failTask(task, error);
    await appendTaskRecord(task);
  }
}

async function pollProviderVideo(task: RuntimeTask) {
  if (!task.providerTaskId) return;
  const result = await getVideoTaskStatus(task.providerTaskId);
  task.progressLines.push(`Video provider status: ${result.status}.`);
  if (result.status === 'succeeded' && (result.localPath || result.videoUrl)) {
    const source = result.localPath || result.videoUrl!;
    const outputPath = await persistGeneratedSource(
      task.projectId,
      source,
      suggestedFilename('video', '.mp4'),
    );
    await completeWithOutput(task, {
      id: `asset_${randomUUID().slice(0, 10)}`,
      kind: 'video',
      path: outputPath,
      mime: 'video/mp4',
      provider: result.provider,
      providerId: result.providerId,
      model: result.model ?? task.providerTaskModel,
      taskId: task.taskId,
      createdAt: new Date().toISOString(),
    });
  } else if (
    result.status === 'failed' ||
    result.status === 'cancelled' ||
    result.status === 'expired'
  ) {
    failTask(task, new Error(result.error ?? `Video task ${result.status}`));
  }
}

async function completeDocumentTask(
  task: RuntimeTask,
  input: StartDesignMediaInput,
) {
  const output = input.output || 'artifacts/document.md';
  const body = `# ${input.prompt.split('\n')[0]?.slice(0, 80) || 'Design document'}\n\n${input.prompt}\n`;
  const written = await writeProjectTextFile(input.projectId, output, body);
  await completeWithOutput(task, {
    id: `asset_${randomUUID().slice(0, 10)}`,
    kind: 'document',
    path: written.path,
    mime: 'text/markdown',
    provider: 'neuma-agent',
    model: task.model,
    taskId: task.taskId,
    createdAt: new Date().toISOString(),
  });
}

async function completeImageTask(
  task: RuntimeTask,
  input: StartDesignMediaInput,
) {
  const projectDir = getProjectDir(input.projectId);
  const referenceImageUrl = input.image
    ? await projectImageToDataUri(input.projectId, input.image)
    : undefined;
  const result = await generateImage({
    prompt: input.prompt,
    workDir: path.join(projectDir, 'assets/generated'),
    aspectRatio: input.aspect,
    model: input.model,
    referenceImageUrl,
  });
  if (!result.success || result.images.length === 0) {
    throw new Error(result.error ?? 'Image provider returned no output');
  }
  const first = result.images[0]!;
  const outputPath = await persistGeneratedSource(
    input.projectId,
    first.localPath || first.url,
    input.output || suggestedFilename('image', '.png'),
  );
  await completeWithOutput(task, {
    id: `asset_${randomUUID().slice(0, 10)}`,
    kind: 'image',
    path: outputPath,
    mime: mimeForPath(outputPath),
    provider: result.provider,
    providerId: result.providerId,
    model: result.model,
    taskId: task.taskId,
    createdAt: new Date().toISOString(),
  });
}

async function completeAudioTask(
  task: RuntimeTask,
  input: StartDesignMediaInput,
) {
  const kind = input.audioKind ?? 'speech';
  if (kind !== 'speech' && kind !== 'voiceover' && kind !== 'sfx') {
    throw new Error(`${kind} audio generation is not configured yet.`);
  }
  const workDir = path.join(getProjectDir(input.projectId), 'assets/generated');
  const result =
    kind === 'sfx'
      ? await synthesizeSoundEffect({
          text: input.prompt,
          model: input.model ?? 'elevenlabs-sfx',
          targetDuration: input.durationSeconds,
          format: 'mp3',
          workDir,
        })
      : await synthesize({
          text: input.prompt,
          voice: input.voice,
          model: input.model,
          targetDuration: input.durationSeconds,
          languageBoost: input.languageBoost,
          format: input.model?.includes('senseaudio') ? 'mp3' : 'wav',
          workDir,
        });
  if (!result.success || !result.localPath) {
    throw new Error(result.error ?? 'Speech provider returned no file');
  }
  const ext = result.format === 'mp3' ? '.mp3' : '.wav';
  const outputPath = await persistGeneratedSource(
    input.projectId,
    result.localPath,
    input.output || suggestedFilename('audio', ext),
  );
  await completeWithOutput(task, {
    id: `asset_${randomUUID().slice(0, 10)}`,
    kind: 'audio',
    path: outputPath,
    mime: mimeForPath(outputPath),
    provider: result.provider,
    model: result.model,
    taskId: task.taskId,
    createdAt: new Date().toISOString(),
  });
}

async function completeHyperframesTask(
  task: RuntimeTask,
  input: StartDesignMediaInput,
) {
  if (!input.compositionDir) {
    throw new Error('HyperFrames rendering requires compositionDir.');
  }
  const rendered = await renderHyperframesComposition({
    projectId: input.projectId,
    compositionDir: input.compositionDir,
    output: input.output,
    onProgress: (line) => task.progressLines.push(line),
  });
  await completeWithOutput(task, {
    id: `asset_${randomUUID().slice(0, 10)}`,
    kind: 'video',
    path: rendered.path,
    mime: 'video/mp4',
    provider: 'hyperframes',
    model: 'hyperframes-html',
    taskId: task.taskId,
    createdAt: new Date().toISOString(),
  });
}

async function completeWithOutput(task: RuntimeTask, output: DesignOutput) {
  task.state = 'done';
  task.endedAt = new Date().toISOString();
  task.durationMs = Date.now() - Date.parse(task.startedAt);
  task.outputPath = output.path;
  task.provider = output.provider;
  task.model = output.model ?? task.model;
  task.progressLines.push(`Output written to ${output.path}.`);
  upsertDesignTaskRow(task);
  await addProjectOutput(task.projectId, output);
  await appendAssetVersion(task.projectId, output);
  await appendAssetRecord(task, output);
  await appendProjectHistory(task.projectId, {
    type: 'media.task.done',
    at: task.endedAt,
    taskId: task.taskId,
    output,
  });
  recordDesignTrace(task, 'ok', { output });
}

function failTask(task: RuntimeTask, error: unknown) {
  task.state =
    error instanceof Error && error.message === 'Task cancelled'
      ? 'cancelled'
      : 'failed';
  task.endedAt = new Date().toISOString();
  task.durationMs = Date.now() - Date.parse(task.startedAt);
  task.providerError = error instanceof Error ? error.message : String(error);
  task.progressLines.push(`WARN: ${task.providerError}`);
  upsertDesignTaskRow(task);
  logger.warn(`DesignMode media task failed: ${task.taskId}`, error);
  recordDesignTrace(task, task.state === 'cancelled' ? 'cancelled' : 'error', {
    error,
  });
}

async function persistGeneratedSource(
  projectId: string,
  source: string,
  filename: string,
): Promise<string> {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  const relative = `assets/generated/${safeName}`;
  const dest = resolveProjectPath(projectId, relative);
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    const buffer = Buffer.from(source.slice(comma + 1), 'base64');
    await fs.writeFile(dest.absolutePath, buffer);
    return dest.relativePath;
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await safeFetch(source, trustedLocalPolicy(), {
      timeoutMs: 120_000,
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Failed to download provider asset: ${response.status}`);
    }
    await fs.writeFile(dest.absolutePath, response.body);
    return dest.relativePath;
  }
  const abs = path.resolve(source);
  await fs.copyFile(abs, dest.absolutePath).catch(async () => {
    const content = await fs.readFile(abs);
    await fs.writeFile(dest.absolutePath, content);
  });
  return dest.relativePath;
}

const PROJECT_IMAGE_DATA_URI_MAX_BYTES = 20 * 1024 * 1024;

async function projectImageToDataUri(projectId: string, relativePath: string) {
  const resolved = resolveProjectPath(projectId, relativePath);
  const stat = await fs.stat(resolved.absolutePath);
  if (stat.size > PROJECT_IMAGE_DATA_URI_MAX_BYTES) {
    throw new Error(
      `Image exceeds 20MB inline-encoding limit: ${relativePath}`,
    );
  }
  const file = await fs.readFile(resolved.absolutePath);
  const mime = mimeForPath(relativePath);
  return `data:${mime};base64,${file.toString('base64')}`;
}

async function appendTaskRecord(task: RuntimeTask) {
  await appendJsonl(
    path.join(getProjectDir(task.projectId), 'provenance/tasks.jsonl'),
    stripRuntime(task),
  );
}

async function appendAssetRecord(task: RuntimeTask, output: DesignOutput) {
  const promptHash = task.prompt
    ? `sha256:${createHash('sha256').update(task.prompt).digest('hex')}`
    : undefined;
  await appendJsonl(
    path.join(getProjectDir(task.projectId), 'provenance/assets.jsonl'),
    {
      assetId: output.id,
      projectId: task.projectId,
      surface: task.surface,
      path: output.path,
      provider: output.provider,
      model: output.model,
      promptHash,
      promptSnapshot: 'prompts/resolved-user.md',
      settings: {},
      references: [],
      taskId: task.taskId,
      createdAt: output.createdAt,
      disclosureText: `AI-generated ${output.kind} · ${output.provider ?? 'unknown'} ${output.model ?? 'auto'} · ${output.createdAt.slice(0, 10)}`,
    },
  );
}

async function appendAssetVersion(projectId: string, output: DesignOutput) {
  const versionPath = path.join(
    getProjectDir(projectId),
    'assets/generated',
    output.id,
    'versions.json',
  );
  const versions = await readJsonFile<DesignOutput[]>(versionPath, []);
  await writeJsonAtomic(versionPath, [
    output,
    ...versions.filter((item) => item.path !== output.path),
  ]);
}

function stripRuntime(task: RuntimeTask): DesignTaskRecord {
  const failure =
    task.state === 'failed'
      ? adaptRunFailure('design', task.providerError ?? 'design_media_failed')
      : undefined;
  return {
    taskId: task.taskId,
    projectId: task.projectId,
    surface: task.surface,
    model: task.model,
    state: task.state,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    durationMs: task.durationMs,
    progressLines: task.progressLines,
    providerError: task.providerError,
    verdict: failure?.verdict,
    recoveryAction:
      failure?.recoveryAction === 'retry_generation'
        ? failure.recoveryAction
        : undefined,
    usedStubFallback: task.usedStubFallback,
    outputPath: task.outputPath,
    provider: task.provider,
    prompt: task.prompt,
    requestedUnits: task.requestedUnits,
    budgetCheck: task.budgetCheck,
  };
}

function recordDesignTrace(
  task: RuntimeTask,
  status: 'running' | 'ok' | 'error' | 'cancelled',
  extra: Record<string, unknown> = {},
) {
  const startedAt = Date.parse(task.startedAt);
  const endedAt = task.endedAt ? Date.parse(task.endedAt) : null;
  recordTraceEvent({
    id: `design-media:${task.taskId}`,
    taskId: task.taskId,
    kind: 'tool_call',
    tool: 'design_mode_media',
    status,
    startedAt,
    endedAt,
    durationMs: task.durationMs ?? undefined,
    provider: task.provider ?? task.providerTaskProvider ?? 'design-mode',
    model: task.model,
    attrs: {
      projectId: task.projectId,
      surface: task.surface,
      outputPath: task.outputPath,
      requestedUnits: task.requestedUnits,
      budget: task.budgetCheck,
      ...extra,
    },
    error: task.providerError ?? extra.error,
  });
}

function upsertDesignTaskRow(task: RuntimeTask) {
  const status =
    task.state === 'done'
      ? 'completed'
      : task.state === 'queued'
        ? 'running'
        : task.state;
  getDatabase()
    .prepare(
      `INSERT INTO tasks (
        id, prompt, title, status, work_dir, project_id, started_at,
        heartbeat_at, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        status = excluded.status,
        work_dir = excluded.work_dir,
        project_id = excluded.project_id,
        heartbeat_at = datetime('now'),
        updated_at = datetime('now')`,
    )
    .run(
      task.taskId,
      task.prompt || `DesignMode ${task.surface} generation`,
      `DesignMode ${task.surface}`,
      status,
      getProjectDir(task.projectId),
      task.projectId,
      task.startedAt,
      task.startedAt,
    );
}

function capabilityList(providers: string[], models: string[]) {
  const configured = providers.length > 0;
  return {
    state: configured ? 'configured' : 'integrated',
    providers,
    models,
  };
}

function suggestedFilename(kind: string, ext: string) {
  return `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}${ext}`;
}

function mimeForPath(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.md')) return 'text/markdown';
  return lower.endsWith('.png') ? 'image/png' : 'application/octet-stream';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
