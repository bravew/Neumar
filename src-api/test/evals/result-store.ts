/**
 * Persists eval results under `~/.neuma/evals/<run-id>/`.
 *
 * Results are redacted before writing — eval cases must never leak raw
 * provider keys, prompt text, or tool result bodies.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { redactValue } from '@/shared/utils/logger';

import type { EvalCase, EvalResult } from './types';

export interface PersistedEvalResult {
  caseId: string;
  tier: EvalCase['tier'];
  passed: boolean;
  score: number | null;
  notes: string | null;
  metrics: Record<string, unknown>;
  startedAt: string;
  endedAt: string;
}

export function getEvalArtifactsDir(runId: string): string {
  const dir = join(homedir(), '.neuma', 'evals', runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeEvalResult(
  runId: string,
  evalCase: EvalCase,
  result: EvalResult,
  startedAt: Date,
  endedAt: Date,
): string {
  const dir = getEvalArtifactsDir(runId);
  const file = join(dir, `${evalCase.id}.json`);
  const payload: PersistedEvalResult = {
    caseId: evalCase.id,
    tier: evalCase.tier,
    passed: result.passed,
    score: result.score ?? null,
    notes: result.notes ?? null,
    metrics:
      (redactValue(result.metrics ?? {}) as Record<string, unknown>) ?? {},
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
  };
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}
