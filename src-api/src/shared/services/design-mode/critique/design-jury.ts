import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';

import { getSetting } from '@/shared/db/operations';

import {
  appendProjectHistory,
  readProjectTextFile,
  resolveProjectPath,
  withProjectLock,
  writeJsonAtomic,
  writeProjectTextFile,
} from '../fs';
import { lintDesignArtifact } from '../lint';
import { getDesignProject } from '../projects';
import type { DesignJuryRun } from '../types';
import { getCritiqueAdapter, getDegradedFallback } from './adapters/registry';
import type {
  CritiquePanelistAdapter,
  CritiquePanelistAdapterContext,
  CritiquePanelistAdapterResult,
  CritiquePanelistTranscript,
} from './adapters/types';
import {
  critiqueArtifactMediaTypeForPath,
  writeCritiqueArtifact,
} from './artifact-writer';
import {
  type PanelEvent,
  publishDesignJuryEvent,
  readDesignJuryPanelEvents,
} from './events';
import {
  clearCritiqueRunViolations,
  emitCritiqueEvent,
  hasCritiqueConformanceViolation,
} from './observability/events';
import {
  recordDesignCritiqueMetrics,
  type CritiqueRunOutcome,
} from './observability/metrics';
import { startCritiqueRunSpan } from './observability/tracing';
import { composeCritiquePanelPrompt } from './panel-composer';
import { parseDesignJuryArtifact } from './parser';
import {
  DESIGN_JURY_PROTOCOL_VERSION,
  DESIGN_JURY_ROLE_ORDER,
  isReviewablePath,
  roleLabel,
} from './protocol';
import { resolveCritiqueRolloutPhase } from './rollout/resolver';
import { getCritiqueRolloutSettings } from './rollout/settings';
import {
  findDesignJuryRunHandle,
  getDesignJuryRunHandle,
  interruptDesignJuryRunHandle,
  markDesignJuryRunHandle,
  registerDesignJuryRun,
} from './run-registry';
import { scoreDesignJuryArtifact } from './scoreboard';

export class DesignJuryDisabledError extends Error {
  constructor() {
    super('Design Jury is disabled');
    this.name = 'DesignJuryDisabledError';
  }
}

const TRUTHY = /^(1|true|yes|on)$/i;

export function isDesignJuryEnabled(): boolean {
  if (TRUTHY.test(process.env.DESIGN_MODE_JURY_ENABLED ?? '')) return true;
  return TRUTHY.test(getSetting('designModeJuryEnabled') ?? '');
}

const JURY_RUN_ID_RE = /^jury_[a-zA-Z0-9_-]{8,32}$/;

export function isDesignJuryRunId(runId: string) {
  return JURY_RUN_ID_RE.test(runId);
}

export async function listDesignJuryRuns(
  projectId: string,
): Promise<DesignJuryRun[]> {
  const root = resolveProjectPath(projectId, 'critique').absolutePath;
  const entries = await fs.readdir(root).catch(() => []);
  const runs = await Promise.all(
    entries
      .filter((entry) => JURY_RUN_ID_RE.test(entry))
      .map(async (entry) => {
        try {
          const raw = await fs.readFile(
            resolveProjectPath(projectId, `critique/${entry}/transcript.json`)
              .absolutePath,
            'utf-8',
          );
          const parsed = JSON.parse(raw) as { run?: DesignJuryRun };
          return parsed.run?.id ? parsed.run : null;
        } catch {
          return null;
        }
      }),
  );
  return runs
    .flatMap((run) => (run ? [run] : []))
    .sort((a, b) =>
      (b.completedAt ?? b.createdAt).localeCompare(
        a.completedAt ?? a.createdAt,
      ),
    );
}

export async function runDesignJury(
  projectId: string,
  input: { artifactPath?: string } = {},
): Promise<DesignJuryRun> {
  if (!isDesignJuryEnabled()) throw new DesignJuryDisabledError();
  return withProjectLock(projectId, async () => {
    const project = await getDesignProject(projectId);
    const artifactPath =
      input.artifactPath ??
      project.outputs.find((output) => isReviewablePath(output.path))?.path ??
      'artifacts/index.html';
    const artifact = await readProjectTextFile(projectId, artifactPath);
    const parsed = parseDesignJuryArtifact(artifact.content);
    const panelPrompt = composeCritiquePanelPrompt({
      artifactPath: artifact.path,
      subject: parsed.content,
    });
    const lint = lintDesignArtifact(parsed.content, { path: artifact.path });
    const createdAt = new Date().toISOString();
    const runId = `jury_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    try {
      const rolloutPhase = resolveCritiqueRolloutPhase(
        getCritiqueRolloutSettings(),
        { createdAt: project.createdAt },
      );
      const runSpan = await startCritiqueRunSpan(runId);
      const root = `critique/${runId}`;
      const handle = registerDesignJuryRun(projectId, runId);
      const runningRun: DesignJuryRun = {
        id: runId,
        projectId,
        artifactPath: artifact.path,
        status: 'running',
        protocolVersion: DESIGN_JURY_PROTOCOL_VERSION,
        createdAt,
        overallScore: 0,
        roles: [],
        mustFix: [],
        quickWins: [],
        transcriptPath: `${root}/transcript.json`,
        summaryPath: `${root}/summary.md`,
      };
      const events: PanelEvent[] = [];
      const transcriptBase = {
        reviewedBytes: parsed.reviewedBytes,
        truncated: parsed.truncated,
        lint,
        promptHash: panelPrompt.promptHash,
        panelSystemPrompt: panelPrompt.system,
      };
      const emit = async (event: PanelEvent, runSnapshot: DesignJuryRun) => {
        events.push(event);
        await writeDesignJuryTranscript(projectId, runSnapshot, {
          ...transcriptBase,
          events,
        });
        publishDesignJuryEvent(projectId, event);
      };
      await emit(
        {
          type: 'run_started',
          runId,
          protocolVersion: DESIGN_JURY_PROTOCOL_VERSION,
          roles: DESIGN_JURY_ROLE_ORDER,
          startedAt: createdAt,
        },
        runningRun,
      );
      await emitCritiqueEvent({
        type: 'critique.run.started',
        runId,
        projectId,
        rolloutPhase,
      });
      if (handle.controller.signal.aborted) {
        runSpan.setAttribute('outcome', 'interrupted');
        runSpan.end();
        return interruptPersistedDesignJuryRun(projectId, runId);
      }

      const scoreboard = scoreDesignJuryArtifact(parsed.content, lint);
      const panelResult = await buildScoreboardPanelEvents({
        runId,
        projectId,
        round: 1,
        artifactPath: artifact.path,
        artifactContent: parsed.content,
        scoreboard,
        signal: handle.controller.signal,
      });
      for (const event of panelResult.events) {
        await emit(event, runningRun);
      }
      if (handle.controller.signal.aborted) {
        runSpan.setAttribute('outcome', 'interrupted');
        runSpan.end();
        return interruptPersistedDesignJuryRun(projectId, runId);
      }

      const artifactRef = await writeCritiqueArtifact(projectId, runId, {
        body: artifact.content,
        mediaType: critiqueArtifactMediaTypeForPath(artifact.path),
      });
      const completedAt = new Date().toISOString();
      const run: DesignJuryRun = {
        ...runningRun,
        status: 'complete',
        completedAt,
        artifactRef,
        overallScore: scoreboard.overallScore,
        roles: scoreboard.roles,
        mustFix: scoreboard.mustFix,
        quickWins: scoreboard.quickWins,
      };
      await emit({ type: 'shipped', runId, artifactRef }, run);
      await writeProjectTextFile(
        projectId,
        run.summaryPath,
        renderSummary(run),
      );
      await appendProjectHistory(projectId, {
        type: 'design-jury.completed',
        at: run.completedAt,
        runId,
        artifactPath: run.artifactPath,
        artifactRef: run.artifactRef,
        overallScore: run.overallScore,
        transcriptPath: run.transcriptPath,
      });
      markDesignJuryRunHandle(projectId, runId, 'complete');
      const outcome: CritiqueRunOutcome =
        panelResult.degradedPanelistCount > 0 ? 'degraded' : 'shipped';
      await finalizeCritiqueRunObservability({
        run,
        rolloutPhase,
        outcome,
        degradedPanelistCount: panelResult.degradedPanelistCount,
        startedAt: createdAt,
        endedAt: completedAt,
      });
      runSpan.setAttribute('outcome', outcome);
      runSpan.setAttribute(
        'conformance_ok',
        !hasCritiqueConformanceViolation(runId),
      );
      runSpan.end();
      return run;
    } finally {
      clearCritiqueRunViolations(runId);
    }
  });
}

export interface InterruptDesignJuryResult {
  runId: string;
  accepted: true;
  prevStatus: DesignJuryRun['status'];
  recovered?: boolean;
  run: DesignJuryRun;
}

export class DesignJuryRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Design Jury run not found: ${runId}`);
    this.name = 'DesignJuryRunNotFoundError';
  }
}

export class DesignJuryRunProjectMismatchError extends Error {
  constructor(runId: string) {
    super(`Design Jury run belongs to a different project: ${runId}`);
    this.name = 'DesignJuryRunProjectMismatchError';
  }
}

export async function interruptDesignJuryRun(
  projectId: string,
  runId: string,
): Promise<InterruptDesignJuryResult> {
  if (!JURY_RUN_ID_RE.test(runId)) throw new DesignJuryRunNotFoundError(runId);

  const otherHandle = findDesignJuryRunHandle(runId);
  if (otherHandle && otherHandle.projectId !== projectId) {
    throw new DesignJuryRunProjectMismatchError(runId);
  }

  const handle = getDesignJuryRunHandle(projectId, runId);
  if (handle?.status === 'running') {
    interruptDesignJuryRunHandle(projectId, runId);
    const run = await interruptPersistedDesignJuryRun(projectId, runId);
    return { runId, accepted: true, prevStatus: 'running', run };
  }

  const run = await readPersistedDesignJuryRun(projectId, runId);
  if (!run) throw new DesignJuryRunNotFoundError(runId);
  if (run.projectId !== projectId) {
    throw new DesignJuryRunProjectMismatchError(runId);
  }
  if (run.status === 'running') {
    const interrupted = await interruptPersistedDesignJuryRun(
      projectId,
      runId,
      'no_live_handle',
    );
    return {
      runId,
      accepted: true,
      prevStatus: 'running',
      recovered: true,
      run: interrupted,
    };
  }
  return { runId, accepted: true, prevStatus: run.status, run };
}

export async function readPersistedDesignJuryRun(
  projectId: string,
  runId: string,
) {
  try {
    const raw = await fs.readFile(
      resolveProjectPath(projectId, `critique/${runId}/transcript.json`)
        .absolutePath,
      'utf-8',
    );
    const parsed = JSON.parse(raw) as { run?: DesignJuryRun };
    return parsed.run?.id ? parsed.run : null;
  } catch {
    return null;
  }
}

async function interruptPersistedDesignJuryRun(
  projectId: string,
  runId: string,
  recoveryReason?: DesignJuryRun['recoveryReason'],
) {
  const run = await readPersistedDesignJuryRun(projectId, runId);
  if (!run) throw new DesignJuryRunNotFoundError(runId);
  const interruptedAt = new Date().toISOString();
  const interruptedRun: DesignJuryRun = {
    ...run,
    status: 'interrupted',
    completedAt: run.completedAt ?? interruptedAt,
    error: run.error ?? 'Design Jury run was interrupted.',
    recoveryReason,
  };
  const events: PanelEvent[] = await readDesignJuryPanelEvents(
    projectId,
    runId,
  ).catch(() => []);
  const interruptedEvent: PanelEvent = { type: 'interrupted', runId };
  events.push(interruptedEvent);
  await writeDesignJuryTranscript(projectId, interruptedRun, {
    events,
  });
  publishDesignJuryEvent(projectId, interruptedEvent);
  await writeProjectTextFile(
    projectId,
    interruptedRun.summaryPath,
    renderSummary(interruptedRun),
  );
  await appendProjectHistory(projectId, {
    type: 'design-jury.interrupted',
    at: interruptedAt,
    runId,
    artifactPath: interruptedRun.artifactPath,
    transcriptPath: interruptedRun.transcriptPath,
    recoveryReason,
  });
  markDesignJuryRunHandle(projectId, runId, 'interrupted');
  await finalizeCritiqueRunObservability({
    run: interruptedRun,
    rolloutPhase: getCritiqueRolloutSettings().rolloutPhase,
    outcome: 'interrupted',
    degradedPanelistCount: countDegradedParserWarnings(events),
    startedAt: interruptedRun.createdAt,
    endedAt: interruptedRun.completedAt ?? interruptedAt,
  });
  return interruptedRun;
}

async function buildScoreboardPanelEvents({
  runId,
  projectId,
  round,
  artifactPath,
  artifactContent,
  scoreboard,
  signal,
}: {
  runId: string;
  projectId: string;
  round: number;
  artifactPath: string;
  artifactContent: string;
  scoreboard: ReturnType<typeof scoreDesignJuryArtifact>;
  signal: AbortSignal;
}): Promise<{ events: PanelEvent[]; degradedPanelistCount: number }> {
  const events: PanelEvent[] = [];
  let degradedPanelistCount = 0;
  for (const role of scoreboard.roles) {
    events.push({ type: 'panelist_open', runId, round, role: role.role });
    const transcript = await runPanelistAdapter({
      runId,
      projectId,
      round,
      artifactPath,
      artifactContent,
      roleScore: role,
      signal,
    });
    if (
      transcript.parserWarnings.some((warning) =>
        warning.startsWith('degraded:'),
      )
    ) {
      degradedPanelistCount += 1;
    }
    for (const warning of transcript.parserWarnings) {
      events.push({ type: 'parser_warning', runId, round, warning });
      await emitCritiqueEvent({
        type: 'critique.parser.warning',
        runId,
        projectId,
        panelistId: role.role,
        round,
        warning,
      });
    }
    events.push({
      type: 'panelist_dim',
      runId,
      round,
      role: role.role,
      rating: transcript.score,
    });
    transcript.mustFix.forEach((body, index) => {
      events.push({
        type: 'panelist_must_fix',
        runId,
        round,
        role: role.role,
        itemId: `${role.role}-${index + 1}`,
        body,
      });
    });
    events.push({ type: 'panelist_close', runId, round, role: role.role });
  }
  events.push({
    type: 'round_end',
    runId,
    round,
    aggregate: {
      mustFix: scoreboard.mustFix.length,
      quickWins: scoreboard.quickWins.length,
      avgScore: scoreboard.overallScore,
    },
  });
  return { events, degradedPanelistCount };
}

async function runPanelistAdapter({
  runId,
  projectId,
  round,
  artifactPath,
  artifactContent,
  roleScore,
  signal,
}: {
  runId: string;
  projectId: string;
  round: number;
  artifactPath: string;
  artifactContent: string;
  roleScore: ReturnType<typeof scoreDesignJuryArtifact>['roles'][number];
  signal: AbortSignal;
}): Promise<CritiquePanelistTranscript> {
  const adapter = getCritiqueAdapter(roleScore.role, 'primary');
  const context = {
    runId,
    projectId,
    role: roleScore.role,
    round,
    artifactPath,
    artifactContent,
    roleScore,
    signal,
  };
  const primary = adapter
    ? await runAdapterWithObservability(adapter, context)
    : ({
        ok: false,
        reason: 'provider_error',
      } satisfies CritiquePanelistAdapterResult);
  if (primary.ok) return primary.transcript;

  await emitCritiqueEvent({
    type: 'critique.panelist.failed',
    runId,
    projectId,
    panelistId: roleScore.role,
    round,
    reason: primary.reason,
  });

  const degraded = getDegradedFallback(roleScore.role, primary.fallback);
  if (degraded) {
    await emitCritiqueEvent({
      type: 'critique.adapter.degraded',
      runId,
      projectId,
      panelistId: roleScore.role,
      round,
      primaryReason: primary.reason,
    });
  }
  const fallback = degraded
    ? await runAdapterWithObservability(degraded, {
        ...context,
        fallbackReason: primary.reason,
      })
    : null;
  if (fallback?.ok) return fallback.transcript;

  return {
    role: roleScore.role,
    round,
    score: roleScore.score,
    passes: roleScore.mustFix.length === 0,
    evidence: roleScore.evidence,
    mustFix: roleScore.mustFix,
    quickWins: roleScore.quickWins,
    parserWarnings: [
      `adapter_failed:${primary.reason}`,
      ...(fallback && !fallback.ok
        ? [`degraded_failed:${fallback.reason}`]
        : []),
    ],
  };
}

async function runAdapterWithObservability(
  adapter: CritiquePanelistAdapter,
  context: CritiquePanelistAdapterContext,
): Promise<CritiquePanelistAdapterResult> {
  const startedAt = Date.now();
  await emitCritiqueEvent({
    type: 'critique.panelist.started',
    runId: context.runId,
    projectId: context.projectId,
    panelistId: context.role,
    round: context.round,
    capability: adapter.capability,
  });
  const result = await runAdapterSafely(adapter, context);
  await emitCritiqueEvent({
    type: 'critique.panelist.ended',
    runId: context.runId,
    projectId: context.projectId,
    panelistId: context.role,
    round: context.round,
    capability: adapter.capability,
    ok: result.ok,
    durationMs: Date.now() - startedAt,
    ...(result.ok
      ? {
          score: result.transcript.score,
          mustFixCount: result.transcript.mustFix.length,
        }
      : {}),
  });
  return result;
}

async function runAdapterSafely(
  adapter: CritiquePanelistAdapter,
  context: Parameters<CritiquePanelistAdapter['run']>[0],
): Promise<CritiquePanelistAdapterResult> {
  try {
    return await adapter.run(context);
  } catch {
    return { ok: false, reason: 'provider_error' };
  }
}

async function finalizeCritiqueRunObservability({
  run,
  rolloutPhase,
  outcome,
  degradedPanelistCount,
  startedAt,
  endedAt,
}: {
  run: DesignJuryRun;
  rolloutPhase: string;
  outcome: CritiqueRunOutcome;
  degradedPanelistCount: number;
  startedAt: string;
  endedAt: string;
}) {
  const conformanceOk = !hasCritiqueConformanceViolation(run.id);
  const durationMs = Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
  recordDesignCritiqueMetrics({
    runId: run.id,
    projectId: run.projectId,
    rolloutPhase,
    outcome,
    panelistCount: run.roles.length,
    mustFixCount: run.mustFix.length,
    totalScore: run.overallScore,
    durationMs,
    conformanceOk,
    degradedPanelistCount,
    startedAt,
    endedAt,
  });
  await emitCritiqueEvent({
    type: 'critique.run.ended',
    runId: run.id,
    projectId: run.projectId,
    rolloutPhase,
    outcome,
    durationMs,
    panelistCount: run.roles.length,
    mustFixCount: run.mustFix.length,
    totalScore: run.overallScore,
    conformanceOk,
    degradedPanelistCount,
    startedAt,
    endedAt,
  });
}

function countDegradedParserWarnings(events: PanelEvent[]) {
  return events.filter(
    (event) =>
      event.type === 'parser_warning' && event.warning.startsWith('degraded:'),
  ).length;
}

async function writeDesignJuryTranscript(
  projectId: string,
  run: DesignJuryRun,
  extra: Record<string, unknown>,
) {
  await writeJsonAtomic(
    resolveProjectPath(projectId, run.transcriptPath).absolutePath,
    {
      schema: DESIGN_JURY_PROTOCOL_VERSION,
      run,
      ...extra,
    },
  );
}

function renderSummary(run: DesignJuryRun): string {
  return [
    `# Design Jury - ${run.artifactPath}`,
    '',
    `Status: ${run.status}`,
    `Overall score: ${run.overallScore}/10`,
    run.recoveryReason ? `Recovery reason: ${run.recoveryReason}` : '',
    '',
    '## Role Scores',
    ...run.roles.map(
      (role) =>
        `- ${roleLabel(role.role)}: ${role.score}/10 - ${role.evidence}`,
    ),
    '',
    '## Must Fix',
    ...run.mustFix.map((item) => `- ${item}`),
    '',
    '## Quick Wins',
    ...run.quickWins.map((item) => `- ${item}`),
    '',
  ].join('\n');
}
