import fs from 'node:fs/promises';
import path from 'node:path';

import { getSetting } from '@/shared/db/operations';

import { getProjectDir } from './fs';
import type {
  DesignBudgetConfig,
  DesignBudgetUsage,
  DesignProject,
  DesignTaskRecord,
} from './types';

export interface DesignBudgetRequest {
  surface: 'image' | 'video' | 'audio' | 'document';
  prompt?: string;
  model?: string;
  lengthSeconds?: number;
  durationSeconds?: number;
}

export interface DesignBudgetCheck {
  allowed: boolean;
  severity: 'none' | 'soft' | 'urgent' | 'blocked';
  message?: string;
  config: Required<DesignBudgetConfig>;
  used: DesignBudgetUsage;
  requested: Partial<DesignBudgetUsage>;
  remaining: DesignBudgetUsage;
}

const DEFAULT_BUDGET: Required<DesignBudgetConfig> = {
  maxImageGenerations: 25,
  maxVideoJobs: 5,
  maxVideoSeconds: 60,
  maxAudioSeconds: 300,
  maxRetryCount: 3,
  maxStorageBytes: 1024 * 1024 * 1024,
  strictProviderMode: false,
};

const ZERO_USAGE: DesignBudgetUsage = {
  imageGenerations: 0,
  videoJobs: 0,
  videoSeconds: 0,
  audioSeconds: 0,
  storageBytes: 0,
};

export async function preflightDesignBudget(
  project: DesignProject,
  request: DesignBudgetRequest,
): Promise<DesignBudgetCheck> {
  const status = await getDesignBudgetStatus(project);
  const requested = budgetUnitsForRequest(project, request);
  const failures = budgetFailures(status, requested);
  const retryFailures = await retryBudgetFailures(project.id, request, status);
  const allFailures = [...failures, ...retryFailures];

  return {
    ...status,
    requested,
    allowed: allFailures.length === 0,
    severity: allFailures.length === 0 ? status.severity : 'blocked',
    message: allFailures.join(' '),
  };
}

export async function getDesignBudgetStatus(
  project: DesignProject,
): Promise<DesignBudgetCheck> {
  const config = resolveDesignBudget(project);
  const used = await readDesignBudgetUsage(project.id);
  const remaining = {
    imageGenerations: Math.max(
      0,
      config.maxImageGenerations - used.imageGenerations,
    ),
    videoJobs: Math.max(0, config.maxVideoJobs - used.videoJobs),
    videoSeconds: Math.max(0, config.maxVideoSeconds - used.videoSeconds),
    audioSeconds: Math.max(0, config.maxAudioSeconds - used.audioSeconds),
    storageBytes: Math.max(0, config.maxStorageBytes - used.storageBytes),
  };
  const ratios = [
    ratio(used.imageGenerations, config.maxImageGenerations),
    ratio(used.videoJobs, config.maxVideoJobs),
    ratio(used.videoSeconds, config.maxVideoSeconds),
    ratio(used.audioSeconds, config.maxAudioSeconds),
    ratio(used.storageBytes, config.maxStorageBytes),
  ];
  const maxRatio = Math.max(...ratios);
  return {
    allowed: true,
    severity: maxRatio >= 0.9 ? 'urgent' : maxRatio >= 0.75 ? 'soft' : 'none',
    config,
    used,
    requested: {},
    remaining,
  };
}

export function resolveDesignBudget(
  project: DesignProject,
): Required<DesignBudgetConfig> {
  return {
    ...DEFAULT_BUDGET,
    ...readGlobalBudgetOverride(),
    ...(project.budget ?? {}),
  };
}

export function budgetUnitsForRequest(
  project: DesignProject,
  request: DesignBudgetRequest,
): Partial<DesignBudgetUsage> {
  if (request.surface === 'image') return { imageGenerations: 1 };
  if (request.surface === 'video') {
    const seconds = request.lengthSeconds ?? project.media?.lengthSeconds ?? 5;
    return { videoJobs: 1, videoSeconds: seconds };
  }
  if (request.surface === 'audio') {
    const seconds =
      request.durationSeconds ?? project.media?.durationSeconds ?? 30;
    return { audioSeconds: seconds };
  }
  return {};
}

async function readDesignBudgetUsage(
  projectId: string,
): Promise<DesignBudgetUsage> {
  const usage = { ...ZERO_USAGE };
  const tasks = await readLatestTaskRecords(projectId);
  for (const task of tasks) {
    if (task.state === 'failed' || task.state === 'cancelled') continue;
    if (task.requestedUnits) {
      usage.imageGenerations += task.requestedUnits.imageGenerations ?? 0;
      usage.videoJobs += task.requestedUnits.videoJobs ?? 0;
      usage.videoSeconds += task.requestedUnits.videoSeconds ?? 0;
      usage.audioSeconds += task.requestedUnits.audioSeconds ?? 0;
      continue;
    }
    if (task.surface === 'image') usage.imageGenerations += 1;
    if (task.surface === 'video') usage.videoJobs += 1;
  }
  usage.storageBytes = await projectStorageBytes(projectId);
  return usage;
}

async function readLatestTaskRecords(
  projectId: string,
): Promise<DesignTaskRecord[]> {
  const file = path.join(getProjectDir(projectId), 'provenance/tasks.jsonl');
  const content = await fs.readFile(file, 'utf-8').catch(() => '');
  const latest = new Map<string, DesignTaskRecord>();
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line) as DesignTaskRecord;
      if (record.taskId) latest.set(record.taskId, record);
    } catch {
      // Ignore malformed historical lines; provenance remains append-only.
    }
  }
  return [...latest.values()];
}

async function retryBudgetFailures(
  projectId: string,
  request: DesignBudgetRequest,
  status: DesignBudgetCheck,
): Promise<string[]> {
  if (!request.prompt || status.config.maxRetryCount === 0) return [];
  const records = await readLatestTaskRecords(projectId);
  const matchingFailures = records.filter(
    (task) =>
      task.state === 'failed' &&
      task.surface === request.surface &&
      task.model === (request.model ?? task.model) &&
      task.prompt === request.prompt,
  );
  if (matchingFailures.length < status.config.maxRetryCount) return [];
  return [
    `Retry budget exceeded: ${matchingFailures.length}/${status.config.maxRetryCount} failed attempts for this prompt.`,
  ];
}

function budgetFailures(
  status: DesignBudgetCheck,
  requested: Partial<DesignBudgetUsage>,
): string[] {
  const out: string[] = [];
  if (
    (requested.imageGenerations ?? 0) + status.used.imageGenerations >
    status.config.maxImageGenerations
  ) {
    out.push(
      `Image generation budget exceeded: ${status.used.imageGenerations}/${status.config.maxImageGenerations} used.`,
    );
  }
  if (
    (requested.videoJobs ?? 0) + status.used.videoJobs >
    status.config.maxVideoJobs
  ) {
    out.push(
      `Video job budget exceeded: ${status.used.videoJobs}/${status.config.maxVideoJobs} used.`,
    );
  }
  if (
    (requested.videoSeconds ?? 0) + status.used.videoSeconds >
    status.config.maxVideoSeconds
  ) {
    out.push(
      `Video seconds budget exceeded: ${status.used.videoSeconds}/${status.config.maxVideoSeconds} used.`,
    );
  }
  if (
    (requested.audioSeconds ?? 0) + status.used.audioSeconds >
    status.config.maxAudioSeconds
  ) {
    out.push(
      `Audio seconds budget exceeded: ${status.used.audioSeconds}/${status.config.maxAudioSeconds} used.`,
    );
  }
  if (status.used.storageBytes > status.config.maxStorageBytes) {
    out.push(
      `Project storage budget exceeded: ${status.used.storageBytes}/${status.config.maxStorageBytes} bytes used.`,
    );
  }
  return out;
}

async function projectStorageBytes(projectId: string): Promise<number> {
  const root = getProjectDir(projectId);
  return directoryBytes(root);
}

async function directoryBytes(dir: string): Promise<number> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directoryBytes(abs);
    } else if (entry.isFile()) {
      total += await fs
        .stat(abs)
        .then((stat) => stat.size)
        .catch(() => 0);
    }
  }
  return total;
}

function ratio(used: number, limit: number): number {
  return limit <= 0 ? (used > 0 ? 1 : 0) : used / limit;
}

function readGlobalBudgetOverride(): Partial<DesignBudgetConfig> {
  const raw = getSetting('designMode') ?? getSetting('designModeBudgets');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as
      | Partial<DesignBudgetConfig>
      | { budgets?: Partial<DesignBudgetConfig>; strictProviderMode?: boolean };
    if (typeof parsed !== 'object' || parsed === null) return {};
    if (
      'budgets' in parsed &&
      typeof parsed.budgets === 'object' &&
      parsed.budgets
    ) {
      return {
        ...parsed.budgets,
        strictProviderMode: parsed.strictProviderMode,
      };
    }
    return parsed as Partial<DesignBudgetConfig>;
  } catch {
    return {};
  }
}
