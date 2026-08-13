import fs from 'node:fs/promises';
import path from 'node:path';

import { getProjectDir } from './fs';
import { listDesignProjects } from './projects';
import type { DesignProject, DesignTaskRecord } from './types';

export interface DesignProjectMetrics {
  projectId: string;
  surface: string;
  status: string;
  assetCount: number;
  exportCount: number;
  assetToExportRatio: number;
  targetedEditCount: number;
  commentCount: number;
  lintFindingCount: number;
  lintP0Count: number;
  lintP1Count: number;
  lintFindingCountsByRule: Record<string, number>;
  exportFormatUsage: Record<string, number>;
  generationByProviderModel: Record<
    string,
    { done: number; failed: number; cancelled: number; running: number }
  >;
  timeToFirstPreviewMs: number | null;
  timeToFirstExportMs: number | null;
  meanRetryCountPerSuccess: number;
}

export interface DesignModeMetrics {
  projectCount: number;
  projectsBySurface: Record<string, number>;
  projectsByStatus: Record<string, number>;
  exportFormatUsage: Record<string, number>;
  generationByProviderModel: DesignProjectMetrics['generationByProviderModel'];
  targetedEditCount: number;
  lintFindingCountsByRule: Record<string, number>;
  lintP0Count: number;
  lintP1Count: number;
  assetToExportRatio: number;
  meanTimeToFirstPreviewMs: number | null;
  meanTimeToFirstExportMs: number | null;
  meanRetriesPerSuccess: number;
  projects: DesignProjectMetrics[];
}

type HistoryEvent = {
  type?: string;
  at?: string;
  path?: string;
  lint?: Array<{ id?: string; severity?: string }>;
  findings?: Array<{ id?: string; severity?: string }>;
  export?: { format?: string };
};

export async function getDesignModeMetrics(): Promise<DesignModeMetrics> {
  const projects = await listDesignProjects();
  const projectMetrics = await Promise.all(projects.map(getProjectMetrics));
  const assetCount = sum(projectMetrics.map((item) => item.assetCount));
  const exportCount = sum(projectMetrics.map((item) => item.exportCount));
  return {
    projectCount: projects.length,
    projectsBySurface: countBy(projects, (project) => project.surface),
    projectsByStatus: countBy(projects, (project) => project.status),
    exportFormatUsage: mergeCounts(
      projectMetrics.map((item) => item.exportFormatUsage),
    ),
    generationByProviderModel: mergeGeneration(
      projectMetrics.map((item) => item.generationByProviderModel),
    ),
    targetedEditCount: sum(
      projectMetrics.map((item) => item.targetedEditCount),
    ),
    lintFindingCountsByRule: mergeCounts(
      projectMetrics.map((item) => item.lintFindingCountsByRule),
    ),
    lintP0Count: sum(projectMetrics.map((item) => item.lintP0Count)),
    lintP1Count: sum(projectMetrics.map((item) => item.lintP1Count)),
    assetToExportRatio: ratio(assetCount, exportCount),
    meanTimeToFirstPreviewMs: meanDefined(
      projectMetrics.map((item) => item.timeToFirstPreviewMs),
    ),
    meanTimeToFirstExportMs: meanDefined(
      projectMetrics.map((item) => item.timeToFirstExportMs),
    ),
    meanRetriesPerSuccess: mean(
      projectMetrics.map((item) => item.meanRetryCountPerSuccess),
    ),
    projects: projectMetrics,
  };
}

export async function getProjectMetrics(
  project: DesignProject,
): Promise<DesignProjectMetrics> {
  const [history, exports, tasks, comments] = await Promise.all([
    readHistory(project.id),
    readProjectJson<Array<{ format?: string; createdAt?: string }>>(
      project.id,
      'exports/index.json',
      [],
    ),
    readTasks(project.id),
    readProjectJson<unknown[]>(project.id, 'comments/comments.json', []),
  ]);
  const lint = collectLint(history);
  const firstPreviewAt = firstEventAt(history, [
    'file.written',
    'project.imported',
    'media.task.done',
  ]);
  const firstExportAt = firstEventAt(history, ['project.exported']);
  const createdAt = Date.parse(project.createdAt);

  return {
    projectId: project.id,
    surface: project.surface,
    status: project.status,
    assetCount: project.outputs.length,
    exportCount: exports.length,
    assetToExportRatio: ratio(project.outputs.length, exports.length),
    targetedEditCount: history.filter((event) => event.type === 'edit.target')
      .length,
    commentCount: comments.length,
    lintFindingCount: lint.total,
    lintP0Count: lint.p0,
    lintP1Count: lint.p1,
    lintFindingCountsByRule: lint.byRule,
    exportFormatUsage: countBy(exports, (item) => item.format ?? 'unknown'),
    generationByProviderModel: generationMetrics(tasks),
    timeToFirstPreviewMs:
      firstPreviewAt && Number.isFinite(createdAt)
        ? Math.max(0, firstPreviewAt - createdAt)
        : null,
    timeToFirstExportMs:
      firstExportAt && Number.isFinite(createdAt)
        ? Math.max(0, firstExportAt - createdAt)
        : null,
    meanRetryCountPerSuccess: retryCountPerSuccess(tasks),
  };
}

async function readHistory(projectId: string): Promise<HistoryEvent[]> {
  const content = await fs
    .readFile(path.join(getProjectDir(projectId), 'history.jsonl'), 'utf-8')
    .catch(() => '');
  return parseJsonl<HistoryEvent>(content);
}

async function readTasks(projectId: string): Promise<DesignTaskRecord[]> {
  const content = await fs
    .readFile(
      path.join(getProjectDir(projectId), 'provenance/tasks.jsonl'),
      'utf-8',
    )
    .catch(() => '');
  return parseJsonl<DesignTaskRecord>(content);
}

async function readProjectJson<T>(
  projectId: string,
  relativePath: string,
  fallback: T,
): Promise<T> {
  try {
    const raw = await fs.readFile(
      path.join(getProjectDir(projectId), relativePath),
      'utf-8',
    );
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseJsonl<T>(content: string): T[] {
  const rows: T[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      // Ignore corrupt trailing/debug lines; metrics must not break UX.
    }
  }
  return rows;
}

function collectLint(history: HistoryEvent[]) {
  const byRule: Record<string, number> = {};
  let p0 = 0;
  let p1 = 0;
  for (const event of history) {
    const findings = event.findings ?? event.lint ?? [];
    for (const finding of findings) {
      const id = finding.id ?? 'unknown';
      byRule[id] = (byRule[id] ?? 0) + 1;
      if (finding.severity === 'p0') p0 += 1;
      if (finding.severity === 'p1') p1 += 1;
    }
  }
  return { byRule, p0, p1, total: p0 + p1 };
}

function firstEventAt(history: HistoryEvent[], types: string[]) {
  let first: number | null = null;
  const allowed = new Set(types);
  for (const event of history) {
    if (!event.type || !allowed.has(event.type) || !event.at) continue;
    const timestamp = Date.parse(event.at);
    if (!Number.isFinite(timestamp)) continue;
    first = first === null ? timestamp : Math.min(first, timestamp);
  }
  return first;
}

function generationMetrics(tasks: DesignTaskRecord[]) {
  const out: DesignProjectMetrics['generationByProviderModel'] = {};
  const latest = new Map<string, DesignTaskRecord>();
  for (const task of tasks) {
    latest.set(task.taskId, task);
  }
  for (const task of latest.values()) {
    const key = `${task.provider ?? 'local'}:${task.model ?? 'auto'}`;
    out[key] ??= { done: 0, failed: 0, cancelled: 0, running: 0 };
    if (task.state === 'done') out[key].done += 1;
    else if (task.state === 'failed') out[key].failed += 1;
    else if (task.state === 'cancelled') out[key].cancelled += 1;
    else out[key].running += 1;
  }
  return out;
}

function retryCountPerSuccess(tasks: DesignTaskRecord[]) {
  const failuresByModel = new Map<string, number>();
  let successes = 0;
  let retriesBeforeSuccess = 0;
  for (const task of tasks.sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  )) {
    const key = `${task.surface}:${task.model}`;
    if (task.state === 'failed' || task.state === 'cancelled') {
      failuresByModel.set(key, (failuresByModel.get(key) ?? 0) + 1);
    }
    if (task.state === 'done') {
      successes += 1;
      retriesBeforeSuccess += failuresByModel.get(key) ?? 0;
      failuresByModel.set(key, 0);
    }
  }
  return successes > 0 ? retriesBeforeSuccess / successes : 0;
}

function countBy<T>(items: T[], keyOf: (item: T) => string) {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyOf(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

function mergeCounts(items: Array<Record<string, number>>) {
  const out: Record<string, number> = {};
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

function mergeGeneration(
  items: DesignProjectMetrics['generationByProviderModel'][],
) {
  const out: DesignProjectMetrics['generationByProviderModel'] = {};
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      out[key] ??= { done: 0, failed: 0, cancelled: 0, running: 0 };
      out[key].done += value.done;
      out[key].failed += value.failed;
      out[key].cancelled += value.cancelled;
      out[key].running += value.running;
    }
  }
  return out;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0
    ? numerator / denominator
    : numerator > 0
      ? numerator
      : 0;
}

function meanDefined(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => value !== null);
  return numbers.length > 0 ? mean(numbers) : null;
}

function mean(values: number[]) {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
