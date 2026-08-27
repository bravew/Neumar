import type { VideoJob, VideoProject } from '@/shared/types/video';

/**
 * Asset plans that produce media. Everything else — an `existing` master, an
 * `image-pan` over a still — already has its bytes and never enters the
 * generation queue.
 */
const GENERATIVE_KINDS = new Set(['ai-clip', 'ai-image']);

export type GenerateSceneState =
  | 'ready'
  | 'not-queued'
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled';

export interface GenerateSceneStatus {
  sceneId: string;
  index: number;
  intent: string;
  kind: string;
  state: GenerateSceneState;
}

function jobStateFor(job: VideoJob | undefined): GenerateSceneState | null {
  switch (job?.status) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'done':
      return 'done';
    case 'error':
      return 'error';
    case 'cancelled':
      return 'cancelled';
    default:
      return null;
  }
}

/**
 * What the Generate step should say about each scene.
 *
 * Scene state comes from the actual `clip-gen` jobs, because that is the only
 * thing that ever moves. Jobs are created when the storyboard is approved, so
 * before that a generative scene is `not-queued` — pending a decision, not
 * pending a worker.
 */
export function generateSceneStatuses(
  project: Pick<VideoProject, 'storyboard'>,
  jobs: readonly VideoJob[],
): GenerateSceneStatus[] {
  const bySceneId = new Map<string, VideoJob>();
  for (const job of jobs) {
    if (job.kind !== 'clip-gen') continue;
    const sceneId = (job.payload as { sceneId?: unknown }).sceneId;
    if (typeof sceneId !== 'string') continue;
    // Later rows win: the list is newest-first, so keep the first seen.
    if (!bySceneId.has(sceneId)) bySceneId.set(sceneId, job);
  }

  return (project.storyboard?.scenes ?? []).map((scene, index) => {
    const kind = scene.assetPlan.kind;
    const generative = GENERATIVE_KINDS.has(kind);
    const state: GenerateSceneState = !generative
      ? 'ready'
      : (jobStateFor(bySceneId.get(scene.id)) ?? 'not-queued');
    return { sceneId: scene.id, index, intent: scene.intent, kind, state };
  });
}

export interface GenerateProgress {
  /** Scenes whose media has to be generated before a render can use them. */
  generative: number;
  done: number;
  running: number;
  /** Generative scenes with no job yet — nothing will happen until approval. */
  notQueued: number;
  failed: number;
}

export function generateProgress(
  statuses: readonly GenerateSceneStatus[],
): GenerateProgress {
  const progress: GenerateProgress = {
    generative: 0,
    done: 0,
    running: 0,
    notQueued: 0,
    failed: 0,
  };
  for (const status of statuses) {
    if (status.state === 'ready') continue;
    progress.generative += 1;
    if (status.state === 'done') progress.done += 1;
    if (status.state === 'running') progress.running += 1;
    if (status.state === 'not-queued') progress.notQueued += 1;
    if (status.state === 'error') progress.failed += 1;
  }
  return progress;
}

export type GenerateAggregateState =
  | 'nothing-to-generate'
  | 'awaiting-approval'
  | 'attention'
  | 'running'
  | 'queued'
  | 'complete';

/**
 * One word for the whole generation queue.
 *
 * Deliberately not the render status: a queue can be busy while the render is
 * idle, and a finished queue does not mean a finished video. Precedence runs
 * from the state that most needs a person — a failure — down to the states
 * that are merely waiting.
 */
export function generateAggregateState(
  statuses: readonly GenerateSceneStatus[],
  storyboardApproved: boolean,
): GenerateAggregateState {
  const progress = generateProgress(statuses);
  if (progress.generative === 0) return 'nothing-to-generate';
  if (progress.failed > 0) return 'attention';
  if (progress.running > 0) return 'running';
  // Nothing is enqueued until approval, so "not queued" is a decision pending
  // on the user rather than work pending on a worker.
  if (progress.notQueued > 0) {
    return storyboardApproved ? 'queued' : 'awaiting-approval';
  }
  if (progress.done === progress.generative) return 'complete';
  return 'queued';
}

/** Share of generative scenes finished, for a progress bar. 0 when none. */
export function generateCompletionPercent(
  statuses: readonly GenerateSceneStatus[],
): number {
  const progress = generateProgress(statuses);
  if (progress.generative === 0) return 0;
  return Math.round((progress.done / progress.generative) * 100);
}
