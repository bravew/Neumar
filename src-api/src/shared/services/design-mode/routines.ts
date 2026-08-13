import { nanoid } from 'nanoid';
import { z } from 'zod';

import { getDatabase } from '@/shared/db';
import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import { resolveDesignSkillId } from './catalogs';
import { appendProjectHistory } from './fs';
import {
  cancelDesignMediaTask,
  startDesignMediaTask,
  waitDesignMediaTask,
} from './media-dispatcher';
import {
  createDesignProject,
  getDesignProject,
  patchDesignProject,
} from './projects';
import {
  computeNextRoutineRun,
  designRoutineScheduleSchema,
  routineScheduleToAutomationSchedule,
  type DesignRoutineSchedule,
} from './routine-schedule';
import { designSurfaceSchema, type DesignSurface } from './types';

const logger = createLogger('DesignRoutines');

const ROUTINE_TICK_INTERVAL_MS = 60_000;
const MAX_DUE_ROUTINES_PER_TICK = 5;
const ROUTINE_SELECT_WITH_LAST_RUN_ERROR = `
  SELECT r.*, run.error AS last_run_error
  FROM design_routines r
  LEFT JOIN design_routine_runs run ON run.id = r.last_run_id
`;

export const routineTargetModeSchema = z.enum([
  'new_project',
  'existing_project',
]);

export const designRoutineStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
]);

const nullableStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .nullable()
  .optional();

const designRoutineBaseSchema = z.object({
  name: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(1).max(20_000),
  surface: designSurfaceSchema.default('prototype'),
  targetMode: routineTargetModeSchema.default('new_project'),
  projectId: nullableStringSchema,
  enabled: z.boolean().default(true),
  designSystemId: nullableStringSchema,
  skillId: nullableStringSchema,
  craftRefs: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  providerProfileId: nullableStringSchema,
  schedule: designRoutineScheduleSchema.default({ kind: 'manual' }),
});

export const createDesignRoutineSchema = designRoutineBaseSchema.refine(
  (value) =>
    value.targetMode !== 'existing_project' || Boolean(value.projectId),
  {
    message: 'Existing-project routines require projectId',
    path: ['projectId'],
  },
);

export const updateDesignRoutineSchema = designRoutineBaseSchema
  .partial()
  .refine(
    (value) =>
      value.targetMode !== 'existing_project' ||
      value.projectId === undefined ||
      Boolean(value.projectId),
    {
      message: 'Existing-project routines require projectId',
      path: ['projectId'],
    },
  );

export const runDesignRoutineSchema = z.object({
  waitForCompletion: z.boolean().optional().default(true),
});

export type CreateDesignRoutineInput = z.infer<
  typeof createDesignRoutineSchema
>;
export type UpdateDesignRoutineInput = z.infer<
  typeof updateDesignRoutineSchema
>;

export interface DesignRoutine {
  id: string;
  name: string;
  prompt: string;
  surface: DesignSurface;
  targetMode: 'new_project' | 'existing_project';
  projectId: string | null;
  enabled: boolean;
  designSystemId: string | null;
  skillId: string | null;
  craftRefs: string[];
  providerProfileId: string | null;
  schedule: DesignRoutineSchedule;
  automationSchedule: ReturnType<typeof routineScheduleToAutomationSchedule>;
  nextRunAt: string | null;
  lastFiredAt: string | null;
  lastRunId: string | null;
  lastRunSummary: string | null;
  lastRunError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DesignRoutineRun {
  id: string;
  routineId: string;
  projectId: string | null;
  taskId: string | null;
  status: z.infer<typeof designRoutineStatusSchema>;
  triggerType: 'manual' | 'schedule';
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
  history: Array<Record<string, unknown>>;
}

export interface DesignRoutineSchedulerStatus {
  enabled: boolean;
  lastTickAt: string | null;
  lastTickSummary: string | null;
  running: boolean;
}

interface RoutineRow {
  id: string;
  name: string;
  prompt: string;
  surface: string;
  target_mode: string;
  project_id: string | null;
  enabled: number;
  design_system_id: string | null;
  skill_id: string | null;
  craft_refs_json: string;
  provider_profile_id: string | null;
  schedule_json: string | null;
  next_run_at: string | null;
  last_fired_at: string | null;
  last_run_id: string | null;
  last_run_summary: string | null;
  last_run_error: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  routine_id: string;
  project_id: string | null;
  task_id: string | null;
  status: string;
  trigger_type: string;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  summary: string | null;
  error: string | null;
  history_json: string;
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function listDesignRoutines(): DesignRoutine[] {
  const rows = getDatabase()
    .prepare(`${ROUTINE_SELECT_WITH_LAST_RUN_ERROR} ORDER BY r.updated_at DESC`)
    .all() as RoutineRow[];
  return rows.map(rowToRoutine);
}

export function getDesignRoutine(id: string): DesignRoutine {
  const row = getDatabase()
    .prepare(`${ROUTINE_SELECT_WITH_LAST_RUN_ERROR} WHERE r.id = ?`)
    .get(id) as RoutineRow | undefined;
  if (!row) throw new Error('DesignMode routine not found');
  return rowToRoutine(row);
}

export function listDesignRoutineRuns(routineId: string): DesignRoutineRun[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM design_routine_runs
       WHERE routine_id = ?
       ORDER BY queued_at DESC`,
    )
    .all(routineId) as RunRow[];
  return rows.map(rowToRun);
}

export async function createDesignRoutine(
  input: CreateDesignRoutineInput,
): Promise<DesignRoutine> {
  const now = new Date().toISOString();
  const id = `droutine_${nanoid(12)}`;
  const next = computeNextRoutineRun(input.schedule);
  const skillId = await resolveDesignSkillId(input.skillId ?? null);
  const row = {
    id,
    name: input.name,
    prompt: input.prompt,
    surface: input.surface,
    target_mode: input.targetMode,
    project_id: input.projectId ?? null,
    enabled: input.enabled ? 1 : 0,
    design_system_id: input.designSystemId ?? null,
    skill_id: skillId,
    craft_refs_json: JSON.stringify(input.craftRefs),
    provider_profile_id: input.providerProfileId ?? null,
    schedule_json: JSON.stringify(input.schedule),
    next_run_at: next.nextRunAt,
    last_fired_at: null,
    last_run_id: null,
    last_run_summary: null,
    created_at: now,
    updated_at: now,
  };
  getDatabase()
    .prepare(
      `INSERT INTO design_routines
        (id, name, prompt, surface, target_mode, project_id, enabled,
         design_system_id, skill_id, craft_refs_json, provider_profile_id,
         schedule_json, next_run_at, last_fired_at, last_run_id,
         last_run_summary, created_at, updated_at)
       VALUES
        (@id, @name, @prompt, @surface, @target_mode, @project_id, @enabled,
         @design_system_id, @skill_id, @craft_refs_json, @provider_profile_id,
         @schedule_json, @next_run_at, @last_fired_at, @last_run_id,
         @last_run_summary, @created_at, @updated_at)`,
    )
    .run(row);
  logger.info('Created DesignMode routine', { id, name: input.name });
  return getDesignRoutine(id);
}

export async function updateDesignRoutine(
  id: string,
  patch: UpdateDesignRoutineInput,
): Promise<DesignRoutine> {
  const current = getDesignRoutine(id);
  const skillId =
    patch.skillId === undefined
      ? current.skillId
      : await resolveDesignSkillId(patch.skillId ?? null);
  const nextRoutine: DesignRoutine = {
    ...current,
    ...patch,
    projectId:
      patch.projectId === undefined
        ? current.projectId
        : (patch.projectId ?? null),
    designSystemId:
      patch.designSystemId === undefined
        ? current.designSystemId
        : (patch.designSystemId ?? null),
    skillId,
    providerProfileId:
      patch.providerProfileId === undefined
        ? current.providerProfileId
        : (patch.providerProfileId ?? null),
    craftRefs: patch.craftRefs ?? current.craftRefs,
    schedule: patch.schedule ?? current.schedule,
    enabled: patch.enabled ?? current.enabled,
    updatedAt: new Date().toISOString(),
  };
  if (nextRoutine.targetMode === 'existing_project' && !nextRoutine.projectId) {
    throw new Error('Existing-project routines require projectId');
  }
  const nextRun = computeNextRoutineRun(nextRoutine.schedule, {
    lastFiredUtc: nextRoutine.lastFiredAt,
  });
  getDatabase()
    .prepare(
      `UPDATE design_routines
       SET name = @name,
           prompt = @prompt,
           surface = @surface,
           target_mode = @target_mode,
           project_id = @project_id,
           enabled = @enabled,
           design_system_id = @design_system_id,
           skill_id = @skill_id,
           craft_refs_json = @craft_refs_json,
           provider_profile_id = @provider_profile_id,
           schedule_json = @schedule_json,
           next_run_at = @next_run_at,
           updated_at = @updated_at
       WHERE id = @id`,
    )
    .run({
      id,
      name: nextRoutine.name,
      prompt: nextRoutine.prompt,
      surface: nextRoutine.surface,
      target_mode: nextRoutine.targetMode,
      project_id: nextRoutine.projectId,
      enabled: nextRoutine.enabled ? 1 : 0,
      design_system_id: nextRoutine.designSystemId,
      skill_id: nextRoutine.skillId,
      craft_refs_json: JSON.stringify(nextRoutine.craftRefs),
      provider_profile_id: nextRoutine.providerProfileId,
      schedule_json: JSON.stringify(nextRoutine.schedule),
      next_run_at: nextRun.nextRunAt,
      updated_at: nextRoutine.updatedAt,
    });
  return getDesignRoutine(id);
}

export function deleteDesignRoutine(id: string): void {
  getDatabase().prepare('DELETE FROM design_routines WHERE id = ?').run(id);
}

export async function runDesignRoutineNow(
  routineId: string,
  options: {
    triggerType?: 'manual' | 'schedule';
    waitForCompletion?: boolean;
  } = {},
): Promise<DesignRoutineRun> {
  const routine = getDesignRoutine(routineId);
  const triggerType = options.triggerType ?? 'manual';
  const run = insertRoutineRun(routine.id, triggerType);
  if (options.waitForCompletion === false) {
    void executeRoutineRun(routine, run).catch((error) => {
      logger.warn(`DesignMode routine run failed: ${run.id}`, error);
    });
    return run;
  }
  return executeRoutineRun(routine, run);
}

export async function cancelDesignRoutineRun(
  runId: string,
): Promise<DesignRoutineRun> {
  const run = getDesignRoutineRun(runId);
  if (run.status !== 'queued' && run.status !== 'running') {
    return run;
  }
  if (run.taskId) {
    await cancelDesignMediaTask(run.taskId).catch((error) => {
      logger.warn(
        `Failed to cancel DesignMode task for routine run ${runId}`,
        error,
      );
    });
  }
  return updateRoutineRun(run.id, {
    status: 'canceled',
    completedAt: new Date().toISOString(),
    summary: 'Routine run canceled.',
  });
}

export function getDesignRoutineSchedulerStatus(): DesignRoutineSchedulerStatus {
  return {
    enabled: isRoutineSchedulerEnabled(),
    lastTickAt: readSchedulerState('lastTickAt'),
    lastTickSummary: readSchedulerState('lastTickSummary'),
    running: schedulerTimer !== null,
  };
}

export function startDesignRoutineScheduler(): void {
  if (schedulerTimer) return;
  recomputeRoutineNextRuns(new Date());
  schedulerTimer = setInterval(() => {
    void tickDesignRoutineScheduler().catch((error) => {
      logger.warn('DesignMode routine scheduler tick failed', error);
    });
  }, ROUTINE_TICK_INTERVAL_MS);
  logger.info('DesignMode routine scheduler started');
}

export function stopDesignRoutineScheduler(): void {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = null;
  logger.info('DesignMode routine scheduler stopped');
}

export async function tickDesignRoutineScheduler(now = new Date()): Promise<{
  fired: number;
  skipped: number;
}> {
  writeSchedulerState('lastTickAt', now.toISOString());
  if (!isRoutineSchedulerEnabled()) {
    writeSchedulerState('lastTickSummary', 'disabled');
    return { fired: 0, skipped: 0 };
  }
  const due = getDatabase()
    .prepare(
      `${ROUTINE_SELECT_WITH_LAST_RUN_ERROR}
       WHERE r.enabled = 1
         AND r.next_run_at IS NOT NULL
         AND r.next_run_at <= ?
       ORDER BY r.next_run_at ASC
       LIMIT ?`,
    )
    .all(now.toISOString(), MAX_DUE_ROUTINES_PER_TICK) as RoutineRow[];
  let fired = 0;
  let skipped = 0;
  for (const row of due) {
    const routine = rowToRoutine(row);
    if (routine.schedule.kind === 'manual') {
      skipped += 1;
      continue;
    }
    if (!claimDesignRoutineScheduleSlot(routine, now, true)) {
      skipped += 1;
      continue;
    }
    void runDesignRoutineNow(routine.id, {
      triggerType: 'schedule',
      waitForCompletion: true,
    }).catch((error) => {
      logger.warn(`Scheduled DesignMode routine failed: ${routine.id}`, error);
    });
    fired += 1;
  }
  const summary = JSON.stringify({ fired, skipped, at: now.toISOString() });
  writeSchedulerState('lastTickSummary', summary);
  return { fired, skipped };
}

function rowToRoutine(row: RoutineRow): DesignRoutine {
  const schedule = parseSchedule(row.schedule_json);
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    surface: designSurfaceSchema.parse(row.surface),
    targetMode: routineTargetModeSchema.parse(row.target_mode),
    projectId: row.project_id,
    enabled: Boolean(row.enabled),
    designSystemId: row.design_system_id,
    skillId: row.skill_id,
    craftRefs: parseStringArray(row.craft_refs_json),
    providerProfileId: row.provider_profile_id,
    schedule,
    automationSchedule: routineScheduleToAutomationSchedule(schedule),
    nextRunAt: row.next_run_at,
    lastFiredAt: row.last_fired_at,
    lastRunId: row.last_run_id,
    lastRunSummary: row.last_run_summary,
    lastRunError: row.last_run_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToRun(row: RunRow): DesignRoutineRun {
  return {
    id: row.id,
    routineId: row.routine_id,
    projectId: row.project_id,
    taskId: row.task_id,
    status: designRoutineStatusSchema.parse(row.status),
    triggerType: row.trigger_type === 'schedule' ? 'schedule' : 'manual',
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    summary: row.summary,
    error: row.error,
    history: parseHistory(row.history_json),
  };
}

function parseSchedule(value: string | null): DesignRoutineSchedule {
  if (!value) return { kind: 'manual' };
  try {
    return designRoutineScheduleSchema.parse(JSON.parse(value));
  } catch {
    return { kind: 'manual' };
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseHistory(value: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object',
        )
      : [];
  } catch {
    return [];
  }
}

function insertRoutineRun(
  routineId: string,
  triggerType: 'manual' | 'schedule',
): DesignRoutineRun {
  const now = new Date().toISOString();
  const id = `drun_${nanoid(12)}`;
  getDatabase()
    .prepare(
      `INSERT INTO design_routine_runs
        (id, routine_id, status, trigger_type, queued_at, history_json)
       VALUES
        (?, ?, 'queued', ?, ?, ?)`,
    )
    .run(
      id,
      routineId,
      triggerType,
      now,
      JSON.stringify([{ at: now, status: 'queued' }]),
    );
  return getDesignRoutineRun(id);
}

function getDesignRoutineRun(runId: string): DesignRoutineRun {
  const row = getDatabase()
    .prepare('SELECT * FROM design_routine_runs WHERE id = ?')
    .get(runId) as RunRow | undefined;
  if (!row) throw new Error('DesignMode routine run not found');
  return rowToRun(row);
}

async function executeRoutineRun(
  routine: DesignRoutine,
  run: DesignRoutineRun,
): Promise<DesignRoutineRun> {
  const startedAt = new Date().toISOString();
  updateRoutineRun(run.id, { status: 'running', startedAt });
  try {
    const projectId = await resolveRoutineProject(routine, run.id);
    const surface = taskSurfaceForRoutine(routine.surface);
    const task = await startDesignMediaTask({
      projectId,
      surface,
      prompt: routine.prompt,
    });
    updateRoutineRun(run.id, {
      projectId,
      taskId: task.taskId,
      status: 'running',
      summary: `DesignMode ${surface} task started.`,
    });
    let latest = task;
    while (latest.state === 'running') {
      const result = await waitDesignMediaTask(latest.taskId);
      latest = result.task;
    }
    const status =
      latest.state === 'done'
        ? 'succeeded'
        : latest.state === 'cancelled'
          ? 'canceled'
          : 'failed';
    const summary =
      latest.state === 'done'
        ? `Generated ${latest.outputPath ?? surface} for ${routine.name}.`
        : (latest.providerError ?? `DesignMode task ${latest.state}.`);
    const completed = updateRoutineRun(run.id, {
      projectId,
      taskId: latest.taskId,
      status,
      completedAt: new Date().toISOString(),
      summary,
      error: status === 'failed' ? (latest.providerError ?? summary) : null,
    });
    updateRoutineCompletion(routine.id, completed);
    return completed;
  } catch (error) {
    const failed = updateRoutineRun(run.id, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      summary: 'Routine run failed.',
      error: error instanceof Error ? error.message : String(error),
    });
    updateRoutineCompletion(routine.id, failed);
    return failed;
  }
}

async function resolveRoutineProject(
  routine: DesignRoutine,
  runId: string,
): Promise<string> {
  if (routine.targetMode === 'existing_project' && routine.projectId) {
    await getDesignProject(routine.projectId);
    await appendProjectHistory(routine.projectId, {
      type: 'routine.run.started',
      at: new Date().toISOString(),
      routineId: routine.id,
      runId,
    });
    return routine.projectId;
  }

  const project = await createDesignProject({
    title: `${routine.name} · ${new Date().toLocaleDateString('en-CA')}`,
    surface: routine.surface,
    designSystemId: routine.designSystemId,
    skillId: routine.skillId,
    brief: {
      prompt: routine.prompt,
      createdFromRoutine: true,
      routineId: routine.id,
      routineRunId: runId,
    },
  });
  if (routine.craftRefs.length > 0) {
    await patchDesignProject(project.id, { craftRefs: routine.craftRefs });
  }
  await appendProjectHistory(project.id, {
    type: 'routine.project.created',
    at: new Date().toISOString(),
    routineId: routine.id,
    runId,
  });
  return project.id;
}

function taskSurfaceForRoutine(
  surface: DesignSurface,
): 'image' | 'video' | 'audio' | 'document' {
  return surface === 'image' || surface === 'video' || surface === 'audio'
    ? surface
    : 'document';
}

function updateRoutineRun(
  runId: string,
  patch: {
    status?: DesignRoutineRun['status'];
    projectId?: string | null;
    taskId?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    summary?: string | null;
    error?: string | null;
  },
): DesignRoutineRun {
  const current = getDesignRoutineRun(runId);
  const history = [
    ...current.history,
    {
      at: new Date().toISOString(),
      status: patch.status ?? current.status,
      summary: patch.summary,
      error: patch.error,
    },
  ];
  const startedAt = patch.startedAt ?? current.startedAt;
  const completedAt = patch.completedAt ?? current.completedAt;
  const durationMs =
    startedAt && completedAt
      ? Date.parse(completedAt) - Date.parse(startedAt)
      : null;
  getDatabase()
    .prepare(
      `UPDATE design_routine_runs
       SET project_id = COALESCE(@projectId, project_id),
           task_id = COALESCE(@taskId, task_id),
           status = @status,
           started_at = @startedAt,
           completed_at = @completedAt,
           duration_ms = @durationMs,
           summary = @summary,
           error = @error,
           history_json = @historyJson
       WHERE id = @id`,
    )
    .run({
      id: runId,
      projectId: patch.projectId ?? current.projectId,
      taskId: patch.taskId ?? current.taskId,
      status: patch.status ?? current.status,
      startedAt,
      completedAt,
      durationMs,
      summary: patch.summary ?? current.summary,
      error: patch.error ?? current.error,
      historyJson: JSON.stringify(history),
    });
  return getDesignRoutineRun(runId);
}

function updateRoutineCompletion(
  routineId: string,
  run: DesignRoutineRun,
): void {
  const routine = getDesignRoutine(routineId);
  const next =
    run.triggerType === 'schedule'
      ? { nextRunAt: routine.nextRunAt }
      : computeNextRoutineRun(routine.schedule, {
          after: new Date(),
          lastFiredUtc: run.completedAt,
        });
  getDatabase()
    .prepare(
      `UPDATE design_routines
       SET last_run_id = ?,
           last_run_summary = ?,
           last_fired_at = COALESCE(?, last_fired_at),
           next_run_at = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      run.id,
      run.summary,
      run.completedAt,
      next.nextRunAt,
      new Date().toISOString(),
      routineId,
    );
}

export function claimDesignRoutineScheduleSlot(
  routine: DesignRoutine,
  now: Date,
  skipMissed: boolean,
): boolean {
  if (!routine.nextRunAt || routine.schedule.kind === 'manual') return false;
  const next = computeNextRoutineRun(routine.schedule, {
    after: skipMissed ? now : new Date(routine.nextRunAt ?? now),
    lastFiredUtc: now.toISOString(),
  });
  const result = getDatabase()
    .prepare(
      `UPDATE design_routines
       SET last_fired_at = ?,
           next_run_at = ?,
           updated_at = ?
       WHERE id = ?
         AND next_run_at = ?`,
    )
    .run(
      now.toISOString(),
      next.nextRunAt,
      new Date().toISOString(),
      routine.id,
      routine.nextRunAt,
    );
  return result.changes === 1;
}

function recomputeRoutineNextRuns(now: Date): void {
  const routines = listDesignRoutines();
  const tx = getDatabase().transaction(() => {
    for (const routine of routines) {
      const next = computeNextRoutineRun(routine.schedule, {
        after: now,
        lastFiredUtc: routine.lastFiredAt,
      });
      getDatabase()
        .prepare(
          `UPDATE design_routines
           SET next_run_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(next.nextRunAt, new Date().toISOString(), routine.id);
    }
  });
  tx();
}

function isRoutineSchedulerEnabled(): boolean {
  const raw = getSetting('designMode');
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { routineSchedulerEnabled?: unknown };
    return parsed.routineSchedulerEnabled === true;
  } catch {
    return false;
  }
}

function readSchedulerState(key: string): string | null {
  const row = getDatabase()
    .prepare('SELECT value FROM design_routine_scheduler_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeSchedulerState(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO design_routine_scheduler_state (key, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
    )
    .run(key, value, new Date().toISOString());
}
