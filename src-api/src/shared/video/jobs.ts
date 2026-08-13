import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { adaptRunFailure } from '@/core/agent/runtime-state';

import { getDatabase } from '@/shared/db';
import { logUsage } from '@/shared/services/usage-logger';
import { createLogger } from '@/shared/utils/logger';

import {
  enforceVideoCostApproval,
  readVideoCostApproval,
  VideoCostApprovalError,
} from './cost-approval';
import {
  editorHandoffPayload,
  runEditorHandoffJob,
  type EditorHandoffJobPayload,
} from './editor-handoff/job';
import { runLinkedSourceSyncJob } from './linked-sources';
import { cancelRender, renderProject } from './pipeline';
import {
  createStoryboardVideoTask,
  generateStoryboardImage,
} from './providers/facade';
import { getProject, getVideoProjectRoot, writeProject } from './store';
import type {
  AspectRatio,
  CaptionRenderMode,
  LoudnessTargetSetting,
  MediaItem,
  MediaProvenanceReference,
  StoryboardScene,
  VideoJob,
  VideoProject,
} from './types';

const logger = createLogger('VideoJobs');
const WORKER_INTERVAL_MS = 5_000;
let workerTimer: NodeJS.Timeout | undefined;
let drainPromise: Promise<VideoJob[]> | undefined;

export interface RenderJobInput {
  aspectRatios?: AspectRatio[];
  destinations?: string[];
  mode?: 'speed' | 'reproducible';
  renderer?: 'ffmpeg' | 'remotion' | 'webcodecs';
  captionMode?: CaptionRenderMode;
  where?: 'local' | 'cloud';
  renderProviderId?: string;
  cloudEgressConfirmed?: boolean;
  loudnessTargetLufs?: LoudnessTargetSetting;
  autoColorEnabled?: boolean;
  autoReframeEnabled?: boolean;
}

export type EditorHandoffJobInput = EditorHandoffJobPayload;

export function startVideoJobWorkers(): void {
  recoverInterruptedJobs();
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    scheduleVideoJobDrain();
  }, WORKER_INTERVAL_MS);
  workerTimer.unref?.();
}

export function stopVideoJobWorkers(): void {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = undefined;
}

export function recoverInterruptedJobs(): number {
  const result = getDatabase()
    .prepare(
      `UPDATE video_jobs
       SET status = 'error',
           result_json = json_set(COALESCE(result_json, '{}'), '$.code', 'interrupted'),
           updated_at = ?
       WHERE status = 'running'`,
    )
    .run(new Date().toISOString());
  return result.changes;
}

export function listVideoJobs(projectId?: string): VideoJob[] {
  const rows = projectId
    ? getDatabase()
        .prepare(
          `SELECT * FROM video_jobs
           WHERE project_id = ?
           ORDER BY created_at DESC`,
        )
        .all(projectId)
    : getDatabase()
        .prepare(`SELECT * FROM video_jobs ORDER BY created_at DESC LIMIT 200`)
        .all();
  return rows.map(rowToJob);
}

export function cancelVideoJob(jobId: string): VideoJob {
  const existing = getVideoJob(jobId);
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE video_jobs
       SET status = 'cancelled', finished_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    )
    .run(now, now, jobId);
  if (existing.kind === 'render' && existing.status === 'running') {
    void Promise.resolve(cancelRender(existing.projectId)).catch((error) => {
      logger.warn('video.render_job.cancel_failed', {
        project_id: existing.projectId,
        job_id: existing.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return getVideoJob(jobId);
}

export async function enqueueRenderJob(
  projectId: string,
  input: RenderJobInput,
): Promise<VideoJob> {
  await getProject(projectId);
  const now = new Date().toISOString();
  const job: VideoJob = {
    id: randomUUID(),
    projectId,
    kind: 'render',
    status: 'queued',
    payload: {
      aspectRatios:
        input.aspectRatios && input.aspectRatios.length > 0
          ? input.aspectRatios
          : ['16:9'],
      mode: input.mode ?? 'speed',
      renderer: input.renderer,
      captionMode: input.captionMode,
      where: input.where,
      renderProviderId: input.renderProviderId,
      cloudEgressConfirmed: input.cloudEgressConfirmed,
      loudnessTargetLufs: input.loudnessTargetLufs,
      autoColorEnabled: input.autoColorEnabled,
      autoReframeEnabled: input.autoReframeEnabled,
      queuedAt: now,
    },
    caller: 'in-app',
  };
  insertVideoJob(job);
  scheduleVideoJobDrain(1);
  return job;
}

export async function enqueueEditorHandoffJob(
  projectId: string,
  input: EditorHandoffJobInput,
  caller: VideoJob['caller'] = 'in-app',
): Promise<VideoJob> {
  await getProject(projectId);
  const now = new Date().toISOString();
  const job: VideoJob = {
    id: randomUUID(),
    projectId,
    kind: 'editor-handoff',
    status: 'queued',
    payload: {
      targets: input.targets,
      mediaMode: input.mediaMode ?? 'copy',
      queuedAt: now,
    },
    caller,
  };
  insertVideoJob(job);
  scheduleVideoJobDrain(1);
  return job;
}

export function listRenderJobs(projectId?: string): VideoJob[] {
  return listVideoJobs(projectId).filter((job) => job.kind === 'render');
}

export function scheduleVideoJobDrain(limit = 2): void {
  void drainVideoJobs(limit).catch((error) => {
    logger.error('video.jobs.drain_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function retryVideoJob(jobId: string): Promise<VideoJob> {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE video_jobs
       SET status = 'queued', result_json = '{}', started_at = NULL,
           finished_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .run(now, jobId);
  const drainWasInFlight = Boolean(drainPromise);
  await drainVideoJobs();
  if (drainWasInFlight) await drainVideoJobs();
  return getVideoJob(jobId);
}

export async function drainVideoJobs(limit = 2): Promise<VideoJob[]> {
  if (drainPromise) return drainPromise;
  drainPromise = drainVideoJobsNow(limit).finally(() => {
    drainPromise = undefined;
  });
  return drainPromise;
}

async function drainVideoJobsNow(limit: number): Promise<VideoJob[]> {
  const jobs = listQueuedJobs(limit);
  const done: VideoJob[] = [];
  for (const job of jobs) {
    done.push(await runJob(job));
  }
  return done;
}

function listQueuedJobs(limit: number): VideoJob[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM video_jobs
       WHERE status = 'queued'
         AND kind IN ('clip-gen', 'source-download', 'linked-source.sync', 'render', 'editor-handoff')
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit);
  return rows.map(rowToJob);
}

function insertVideoJob(job: VideoJob): void {
  getDatabase()
    .prepare(
      `INSERT INTO video_jobs
        (id, project_id, kind, status, payload_json, result_json,
         started_at, finished_at, cost_cents, caller)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      job.id,
      job.projectId,
      job.kind,
      job.status,
      JSON.stringify(job.payload),
      JSON.stringify(job.result ?? {}),
      job.startedAt ?? null,
      job.finishedAt ?? null,
      job.costCents ?? 0,
      job.caller,
    );
}

async function runJob(job: VideoJob): Promise<VideoJob> {
  const current = getVideoJob(job.id);
  if (current.status !== 'queued') return current;
  markJobRunning(job.id);
  try {
    if (job.kind === 'render') {
      const result = await runRenderJob(job);
      const latest = getVideoJob(job.id);
      return latest.status === 'cancelled'
        ? latest
        : markJobDone(job.id, result);
    }
    if (job.kind === 'editor-handoff') {
      const result = await runEditorHandoffJob({
        ...job,
        payload: { ...editorHandoffPayload(job.payload) },
      });
      const latest = getVideoJob(job.id);
      return latest.status === 'cancelled'
        ? latest
        : markJobDone(job.id, result);
    }
    if (job.kind === 'clip-gen') {
      return await runClipGenerationJob(job);
    }
    if (job.kind === 'source-download') {
      // yt-dlp source-download worker is not yet wired. The route enqueues
      // jobs with a pre-built args[] payload; once the spawn helper lands,
      // replace this branch with a real runner. Failing loudly here is
      // intentional so the UI surfaces "import failed" rather than silently
      // leaving the job queued forever (round-1 regression).
      throw new Error(
        'yt-dlp source download is not yet implemented — the worker that ' +
          'spawns yt-dlp and registers the resulting file has not landed yet.',
      );
    }
    if (job.kind === 'linked-source.sync') {
      return markJobDone(job.id, await runLinkedSourceSyncJob(job));
    }
    return markJobDone(job.id, { skipped: true });
  } catch (error) {
    logger.warn('video.job.failed', {
      project_id: job.projectId,
      job_id: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    const latest = getVideoJob(job.id);
    if (latest.status === 'cancelled') return latest;
    return markJobError(job.id, error);
  }
}

async function runRenderJob(job: VideoJob): Promise<Record<string, unknown>> {
  const payload = renderJobPayload(job.payload);
  const rendered: Array<{ aspectRatio: AspectRatio; outputPath?: string }> = [];
  for (const aspectRatio of payload.aspectRatios) {
    if (getVideoJob(job.id).status === 'cancelled') {
      return { cancelled: true, rendered };
    }
    const status = await renderProject(job.projectId, {
      aspectRatio,
      mode: payload.mode,
      renderer: payload.renderer,
      captionMode: payload.captionMode,
      where: payload.where,
      renderProviderId: payload.renderProviderId,
      cloudEgressConfirmed: payload.cloudEgressConfirmed,
      loudnessTargetLufs: payload.loudnessTargetLufs,
      autoColorEnabled: payload.autoColorEnabled,
      autoReframeEnabled: payload.autoReframeEnabled,
    });
    rendered.push({ aspectRatio, outputPath: status.outputPath });
  }
  return {
    aspectRatios: payload.aspectRatios,
    rendered,
    destinationCount: payload.destinations.length,
  };
}

function renderJobPayload(
  payload: Record<string, unknown>,
): Required<Pick<RenderJobInput, 'aspectRatios' | 'destinations' | 'mode'>> &
  Omit<RenderJobInput, 'aspectRatios' | 'destinations' | 'mode'> {
  return {
    aspectRatios: readAspectRatios(payload.aspectRatios),
    destinations: Array.isArray(payload.destinations)
      ? payload.destinations.filter(
          (item): item is string => typeof item === 'string',
        )
      : [],
    mode: payload.mode === 'reproducible' ? 'reproducible' : 'speed',
    renderer:
      payload.renderer === 'remotion' ||
      payload.renderer === 'ffmpeg' ||
      payload.renderer === 'webcodecs'
        ? payload.renderer
        : undefined,
    captionMode:
      payload.captionMode === 'off' ||
      payload.captionMode === 'burn-in' ||
      payload.captionMode === 'sidecar'
        ? payload.captionMode
        : undefined,
    where:
      payload.where === 'local' || payload.where === 'cloud'
        ? payload.where
        : undefined,
    renderProviderId:
      typeof payload.renderProviderId === 'string'
        ? payload.renderProviderId
        : undefined,
    cloudEgressConfirmed:
      typeof payload.cloudEgressConfirmed === 'boolean'
        ? payload.cloudEgressConfirmed
        : undefined,
    loudnessTargetLufs:
      payload.loudnessTargetLufs === -14 ||
      payload.loudnessTargetLufs === -16 ||
      payload.loudnessTargetLufs === -23 ||
      payload.loudnessTargetLufs === 'off'
        ? payload.loudnessTargetLufs
        : undefined,
    autoColorEnabled:
      typeof payload.autoColorEnabled === 'boolean'
        ? payload.autoColorEnabled
        : undefined,
    autoReframeEnabled:
      typeof payload.autoReframeEnabled === 'boolean'
        ? payload.autoReframeEnabled
        : undefined,
  };
}

function readAspectRatios(value: unknown): AspectRatio[] {
  if (!Array.isArray(value)) return ['16:9'];
  const ratios = value.filter(
    (item): item is AspectRatio =>
      item === '16:9' || item === '9:16' || item === '1:1' || item === '4:5',
  );
  return ratios.length > 0 ? ratios.slice(0, 4) : ['16:9'];
}

async function runClipGenerationJob(job: VideoJob): Promise<VideoJob> {
  const project = await getProject(job.projectId);
  const sceneId = String(job.payload.sceneId ?? '');
  const scene = project.storyboard?.scenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error('Storyboard scene not found for clip job');
  const costCents = estimateJobCost(scene);
  enforceBudget(project, costCents);
  const costGate = enforceVideoCostApproval(project, {
    estimatedCents: costCents,
    approval: readVideoCostApproval(job.payload.costApproval),
    scopeId: job.id,
  });

  if (scene.assetPlan.kind === 'ai-image') {
    const result = await generateStoryboardImage({
      kind: 'image',
      prompt: scene.assetPlan.prompt,
      aspectRatio: scene.assetPlan.aspectRatio ?? '16:9',
      size: scene.assetPlan.size,
      provider: scene.assetPlan.provider,
    });
    const localPath = result.outputPath;
    if (!localPath) {
      return markJobDone(job.id, {
        provider: result.provider,
        model: result.model,
        pendingDownload: true,
      });
    }
    const asset = createGeneratedAsset(project, scene, localPath, {
      provider: result.provider,
      model: result.model,
      costCents: result.costCents,
      jobId: job.id,
    });
    await appendAssetAndSpend(project, asset, result.costCents);
    logPaidUsage(job, result.provider, result.model, result.costCents, 'image');
    return markJobDone(job.id, {
      assetId: asset.id,
      provider: result.provider,
      costCents: result.costCents,
      costApproval: costGate,
    });
  }

  if (scene.assetPlan.kind !== 'ai-clip') {
    throw new Error('Clip generation job has no AI asset plan');
  }

  const result = await createStoryboardVideoTask({
    kind: scene.assetPlan.refImageId ? 'i2v' : 't2v',
    prompt: scene.assetPlan.prompt,
    durationMs: scene.assetPlan.durationMs ?? scene.durationMs,
    aspectRatio: scene.assetPlan.aspectRatio ?? '16:9',
    provider: scene.assetPlan.provider,
    seed: scene.assetPlan.seed,
  });
  await reserveProjectSpend(project, result.costCents);
  logPaidUsage(job, result.provider, result.model, result.costCents, 'video');
  return markJobDone(job.id, {
    providerTaskId: result.taskId,
    provider: result.provider,
    model: result.model,
    costCents: result.costCents,
    costApproval: costGate,
  });
}

export function getVideoJob(jobId: string): VideoJob {
  const row = getDatabase()
    .prepare(`SELECT * FROM video_jobs WHERE id = ?`)
    .get(jobId);
  if (!row) throw new Error('Video job not found');
  return rowToJob(row);
}

function markJobRunning(jobId: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(
      `UPDATE video_jobs
       SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE id = ?`,
    )
    .run(now, now, jobId);
}

function markJobDone(jobId: string, result: Record<string, unknown>): VideoJob {
  const now = new Date().toISOString();
  const costCents =
    typeof result.costCents === 'number' && Number.isFinite(result.costCents)
      ? Math.max(0, Math.round(result.costCents))
      : 0;
  getDatabase()
    .prepare(
      `UPDATE video_jobs
       SET status = 'done',
           result_json = ?,
           cost_cents = ?,
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(result), costCents, now, now, jobId);
  return getVideoJob(jobId);
}

function markJobError(jobId: string, error: unknown): VideoJob {
  const now = new Date().toISOString();
  const result = jobErrorResult(error);
  const costCents =
    typeof result.costCents === 'number' && Number.isFinite(result.costCents)
      ? Math.max(0, Math.round(result.costCents))
      : 0;
  getDatabase()
    .prepare(
      `UPDATE video_jobs
       SET status = 'error',
           result_json = ?,
           cost_cents = ?,
           finished_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(result), costCents, now, now, jobId);
  return getVideoJob(jobId);
}

function jobErrorResult(error: unknown): Record<string, unknown> {
  if (error instanceof VideoCostApprovalError) {
    return {
      code: error.code,
      message: error.message,
      costApproval: error.decision,
      costCents: error.decision.estimatedCents,
    };
  }
  return {
    code: error instanceof Error ? error.message : String(error),
  };
}

function estimateJobCost(scene: StoryboardScene): number {
  if (scene.assetPlan.kind === 'ai-image') return 20;
  if (scene.assetPlan.kind === 'ai-clip') {
    return (
      Math.ceil((scene.assetPlan.durationMs ?? scene.durationMs) / 1000) * 12
    );
  }
  return 0;
}

function enforceBudget(project: VideoProject, estimatedCents: number): void {
  const cap = Math.round((project.budget?.capUsd ?? 0) * 100);
  const spent = Math.round((project.budget?.spentUsd ?? 0) * 100);
  if (spent + estimatedCents > cap) {
    throw new Error('budget-exceeded');
  }
}

async function appendAssetAndSpend(
  project: VideoProject,
  asset: MediaItem,
  costCents: number,
): Promise<void> {
  const spentUsd = (project.budget?.spentUsd ?? 0) + costCents / 100;
  const next = {
    ...project,
    assets: [...project.assets, asset],
    budget: { ...(project.budget ?? { capUsd: 5, spentUsd: 0 }), spentUsd },
    updatedAt: new Date().toISOString(),
  };
  await writeProject(next);
  updateBudgetSpendRow(project.id, spentUsd);
}

async function reserveProjectSpend(
  project: VideoProject,
  costCents: number,
): Promise<void> {
  const spentUsd = (project.budget?.spentUsd ?? 0) + costCents / 100;
  await writeProject({
    ...project,
    budget: { ...(project.budget ?? { capUsd: 5, spentUsd: 0 }), spentUsd },
    updatedAt: new Date().toISOString(),
  });
  updateBudgetSpendRow(project.id, spentUsd);
}

function updateBudgetSpendRow(projectId: string, spentUsd: number): void {
  getDatabase()
    .prepare(
      `UPDATE video_projects
       SET budget_spent_cents = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(Math.round(spentUsd * 100), new Date().toISOString(), projectId);
}

function createGeneratedAsset(
  project: VideoProject,
  scene: StoryboardScene,
  localPath: string,
  provenance: {
    provider: string;
    model: string;
    costCents: number;
    jobId: string;
  },
): MediaItem {
  const workspaceRoot = getVideoProjectRoot(project.id);
  const collectionId = `scene:${scene.id}`;
  return {
    id: randomUUID(),
    kind: 'image',
    source: 'ai-clip',
    path: path.relative(workspaceRoot, localPath),
    metadata: { durationMs: scene.durationMs },
    collectionId,
    collectionLabel: scene.intent,
    provenance: {
      provider: provenance.provider,
      model: provenance.model,
      cost: provenance.costCents / 100,
      jobId: provenance.jobId,
      generatedFor: { sceneId: scene.id, rangeMs: [0, scene.durationMs] },
      references: sceneReferenceLinks(scene),
      variantOf: collectionId,
      prompt:
        scene.assetPlan.kind === 'ai-image' ||
        scene.assetPlan.kind === 'ai-clip'
          ? scene.assetPlan.prompt
          : scene.intent,
    },
  };
}

function sceneReferenceLinks(
  scene: StoryboardScene,
): MediaProvenanceReference[] {
  if (scene.assetPlan.kind === 'ai-image') {
    return (scene.assetPlan.refImageIds ?? []).map((id) => ({
      kind: 'asset',
      id,
    }));
  }
  if (scene.assetPlan.kind !== 'ai-clip') return [];
  const references: MediaProvenanceReference[] = [];
  if (scene.assetPlan.refImageId) {
    references.push({ kind: 'asset', id: scene.assetPlan.refImageId });
  }
  if (scene.assetPlan.refImageTailId) {
    references.push({ kind: 'asset', id: scene.assetPlan.refImageTailId });
  }
  return references;
}

function logPaidUsage(
  job: VideoJob,
  provider: string,
  model: string,
  costCents: number,
  callType: 'image' | 'video',
): void {
  logUsage({
    callType,
    provider,
    model,
    totalCostUsd: costCents / 100,
    unitType: callType === 'video' ? 'video_second' : 'image',
    unitCount: Number(job.payload.durationMs ?? 1),
    metadata: {
      project_id: job.projectId,
      job_id: job.id,
      scene_id: job.payload.sceneId,
      caller: 'video-mode',
    },
  });
}

function rowToJob(row: unknown): VideoJob {
  const value = row as Record<string, unknown>;
  const result = parseJson(value.result_json);
  const failure =
    value.status === 'error'
      ? adaptRunFailure(
          'video',
          typeof result.code === 'string' ? result.code : 'video_job_failed',
        )
      : undefined;
  return {
    id: String(value.id),
    projectId: String(value.project_id),
    kind: value.kind as VideoJob['kind'],
    status: value.status as VideoJob['status'],
    payload: parseJson(value.payload_json),
    result,
    verdict: failure?.verdict,
    recoveryAction:
      failure?.recoveryAction === 'retry_render'
        ? failure.recoveryAction
        : undefined,
    startedAt: value.started_at ? String(value.started_at) : undefined,
    finishedAt: value.finished_at ? String(value.finished_at) : undefined,
    costCents: Number(value.cost_cents ?? 0),
    caller: value.caller as VideoJob['caller'],
  };
}

function parseJson(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
