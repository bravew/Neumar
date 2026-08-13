import fs from 'node:fs/promises';
import path from 'node:path';

import type { DesignJuryRole, DesignJuryRoleScore } from '../../types';
import { getCritiqueAdapter, listCritiqueAdapters } from '../adapters/registry';
import type {
  CritiquePanelistAdapterContext,
  CritiquePanelistTranscript,
} from '../adapters/types';
import { emitCritiqueEvent } from '../observability/events';
import type {
  CritiqueConformanceExpected,
  CritiqueConformanceReport,
} from './types';

interface CritiqueConformanceFixturePrompt {
  runId: string;
  projectId: string;
  role: DesignJuryRole;
  round: number;
  artifactPath: string;
  artifactContent: string;
  roleScore: DesignJuryRoleScore;
}

export async function runCritiqueConformance(options: {
  fixturesRoot: string;
  live?: boolean;
}) {
  const checks = [];
  for (const fixture of await loadFixtures(options.fixturesRoot)) {
    const adapter = getCritiqueAdapter(fixture.prompt.role, 'primary');
    if (!adapter) {
      await emitCritiqueEvent({
        type: 'critique.conformance.violation',
        adapterId: `missing:${fixture.prompt.role}`,
        panelistId: fixture.prompt.role,
        caseId: fixture.caseId,
        fieldsDiffed: ['adapter'],
      });
      checks.push({
        adapterId: `missing:${fixture.prompt.role}`,
        role: fixture.prompt.role,
        caseId: fixture.caseId,
        ok: false,
        diff: [
          {
            field: 'adapter',
            expected: 'registered primary adapter',
            actual: null,
          },
        ],
      });
      continue;
    }
    const result = await adapter.run({
      ...fixture.prompt,
      signal: AbortSignal.timeout(options.live ? 30_000 : 1_000),
    } satisfies CritiquePanelistAdapterContext);
    const actual = result.ok ? result.transcript : result;
    const diff = diffTranscript(fixture.expected, actual);
    if (diff.length > 0) {
      await emitCritiqueEvent({
        type: 'critique.conformance.violation',
        adapterId: adapter.id,
        panelistId: fixture.prompt.role,
        caseId: fixture.caseId,
        fieldsDiffed: diff.map((entry) => entry.field),
      });
    }
    checks.push({
      adapterId: adapter.id,
      role: fixture.prompt.role,
      caseId: fixture.caseId,
      ok: diff.length === 0,
      ...(diff.length > 0 ? { diff } : {}),
    });
  }

  const failuresByAdapter: Record<string, number> = {};
  for (const check of checks) {
    if (check.ok) continue;
    failuresByAdapter[check.adapterId] =
      (failuresByAdapter[check.adapterId] ?? 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    adapters: listCritiqueAdapters(),
    checks,
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.ok).length,
      failed: checks.filter((check) => !check.ok).length,
      failuresByAdapter,
    },
  } satisfies CritiqueConformanceReport;
}

async function loadFixtures(fixturesRoot: string) {
  const fixtures = [];
  const roleDirs = await fs.readdir(fixturesRoot, { withFileTypes: true });
  for (const roleDir of roleDirs) {
    if (!roleDir.isDirectory()) continue;
    const roleRoot = path.join(fixturesRoot, roleDir.name);
    const caseDirs = await fs.readdir(roleRoot, { withFileTypes: true });
    for (const caseDir of caseDirs) {
      if (!caseDir.isDirectory()) continue;
      const caseRoot = path.join(roleRoot, caseDir.name);
      fixtures.push({
        caseId: caseDir.name,
        prompt: await readJson<CritiqueConformanceFixturePrompt>(
          path.join(caseRoot, 'prompt.json'),
        ),
        response: await readJson<unknown>(path.join(caseRoot, 'response.json')),
        expected: await readJson<CritiqueConformanceExpected>(
          path.join(caseRoot, 'expected.json'),
        ),
      });
    }
  }
  return fixtures;
}

async function readJson<T>(file: string) {
  return JSON.parse(await fs.readFile(file, 'utf8')) as T;
}

function diffTranscript(expected: CritiquePanelistTranscript, actual: unknown) {
  if (!actual || typeof actual !== 'object' || !('score' in actual)) {
    return [{ field: 'transcript', expected, actual }];
  }
  const current = actual as CritiquePanelistTranscript;
  const fields: Array<keyof CritiquePanelistTranscript> = [
    'role',
    'round',
    'score',
    'passes',
    'evidence',
    'mustFix',
    'quickWins',
    'parserWarnings',
  ];
  return fields.flatMap((field) =>
    JSON.stringify(normalizeTranscriptField(field, current[field])) ===
    JSON.stringify(normalizeTranscriptField(field, expected[field]))
      ? []
      : [{ field, expected: expected[field], actual: current[field] }],
  );
}

function normalizeTranscriptField(
  field: keyof CritiquePanelistTranscript,
  value: CritiquePanelistTranscript[keyof CritiquePanelistTranscript],
) {
  if (
    (field === 'mustFix' ||
      field === 'quickWins' ||
      field === 'parserWarnings') &&
    Array.isArray(value)
  ) {
    return [...value].sort();
  }
  return value;
}
