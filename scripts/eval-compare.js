#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const caseId = process.argv.find((arg) => !arg.startsWith('--'));
const jsonMode = process.argv.includes('--json');
const baseDir =
  process.env.NEUMA_EVALS_DIR ?? join(homedir(), '.neuma', 'evals');

function readRuns(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => {
      const path = join(dir, file);
      return { file, data: JSON.parse(readFileSync(path, 'utf8')) };
    });
}

const caseDirs = caseId
  ? [caseId]
  : existsSync(baseDir)
    ? readdirSync(baseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];

const comparisons = caseDirs.flatMap((id) => {
  const runs = readRuns(join(baseDir, id));
  if (runs.length < 2) return [];
  const previous = runs.at(-2);
  const current = runs.at(-1);
  return [
    {
      caseId: id,
      previous: previous.file,
      current: current.file,
      previousScore: previous.data.score ?? previous.data.weightedScore ?? null,
      currentScore: current.data.score ?? current.data.weightedScore ?? null,
      previousCostUsd: previous.data.costUsd ?? null,
      currentCostUsd: current.data.costUsd ?? null,
    },
  ];
});

if (jsonMode) {
  process.stdout.write(`${JSON.stringify({ comparisons }, null, 2)}\n`);
} else {
  for (const item of comparisons) {
    console.log(
      `${item.caseId}: score ${item.previousScore ?? 'n/a'} -> ${item.currentScore ?? 'n/a'}, cost ${item.previousCostUsd ?? 'n/a'} -> ${item.currentCostUsd ?? 'n/a'}`,
    );
  }
}
