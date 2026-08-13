import { z } from 'zod';

export const LEG_STALL_TIMEOUT_MS = 10 * 60 * 1000;

export const jobStates = [
  'drafted',
  'pending_approval',
  'approved',
  'running',
  'succeeded',
  'failed',
  'canceled',
] as const;

export const legStates = [
  'queued',
  'reformatting',
  'uploading',
  'uploaded',
  'finalizing',
  'published',
  'failed',
  'canceled',
] as const;

export type JobState = (typeof jobStates)[number];
export type LegState = (typeof legStates)[number];

export const jobStateSchema = z.enum(jobStates);
export const legStateSchema = z.enum(legStates);

export const terminalJobStates = ['succeeded', 'failed', 'canceled'] as const;
export const terminalLegStates = ['published', 'failed', 'canceled'] as const;

const terminalJobStateSet = new Set<JobState>(terminalJobStates);
const terminalLegStateSet = new Set<LegState>(terminalLegStates);

export const jobTransitions: Readonly<Record<JobState, readonly JobState[]>> = {
  drafted: ['pending_approval', 'approved'],
  pending_approval: ['approved'],
  approved: ['running', 'failed'],
  running: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  canceled: [],
};

export const legTransitions: Readonly<Record<LegState, readonly LegState[]>> = {
  queued: ['reformatting', 'uploading', 'failed'],
  reformatting: ['uploading', 'failed'],
  uploading: ['uploaded', 'failed'],
  uploaded: ['finalizing', 'failed'],
  finalizing: ['published', 'failed'],
  published: [],
  failed: [],
  canceled: [],
};

export function isTerminalJobState(state: JobState): boolean {
  return terminalJobStateSet.has(state);
}

export function isTerminalLegState(state: LegState): boolean {
  return terminalLegStateSet.has(state);
}

export function canTransitionJob(current: JobState, next: JobState): boolean {
  if (current === next) return true;
  if (!isTerminalJobState(current) && next === 'canceled') return true;
  return jobTransitions[current].includes(next);
}

export function canTransitionLeg(current: LegState, next: LegState): boolean {
  if (current === next) return true;
  if (!isTerminalLegState(current) && next === 'canceled') return true;
  return legTransitions[current].includes(next);
}

export function assertJobTransition(current: JobState, next: JobState): void {
  if (!canTransitionJob(current, next)) {
    throw new Error(`Illegal publish job transition: ${current} -> ${next}`);
  }
}

export function assertLegTransition(current: LegState, next: LegState): void {
  if (!canTransitionLeg(current, next)) {
    throw new Error(`Illegal publish leg transition: ${current} -> ${next}`);
  }
}

export interface StallInspectableLeg {
  state: LegState;
  chunk_offset_bytes: number;
  last_progress_at: string | null;
  updated_at: string;
}

function parseSqliteTimestamp(value: string): number {
  const normalized = value.includes('T')
    ? value
    : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return parsed;
}

export function isLegStalled(
  row: StallInspectableLeg,
  nowMs = Date.now(),
  timeoutMs = LEG_STALL_TIMEOUT_MS,
): boolean {
  if (row.state !== 'uploading') return false;
  const lastProgress = row.last_progress_at ?? row.updated_at;
  return nowMs - parseSqliteTimestamp(lastProgress) > timeoutMs;
}
