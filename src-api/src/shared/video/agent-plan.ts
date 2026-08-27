import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

import { recordVideoIntentLog } from './recipes';
import { getProject, getVideoProjectDir, updateProjectDocument } from './store';
import type {
  MediaItem,
  VideoAgentPlan,
  VideoAgentPlanStep,
  VideoProject,
} from './types';

const logger = createLogger('VideoAgentPlan');

export interface WriteVideoAgentPlanInput {
  title: string;
  request: string;
  assumptions?: string[];
  steps: VideoAgentPlanStep[];
}

export interface VideoAgentPlanReadResult {
  plan?: VideoAgentPlan;
  markdownPath: string;
  markdownDigest?: string;
  drifted: boolean;
}

/**
 * Write the plan for this project, superseding any previous revision.
 *
 * The result is immediately executable — see `VideoAgentPlan` for why there is
 * no separate approval transition. Writing a plan is itself reversible: the
 * previous revision stays in `agent/plan.md` history and the intent log, and
 * nothing about the project's media changes until a step runs.
 */
export async function writeVideoAgentPlan(
  projectId: string,
  input: WriteVideoAgentPlanInput,
): Promise<VideoAgentPlanReadResult> {
  const createdAt = new Date().toISOString();
  const project = await updateProjectDocument(projectId, (current) => {
    const base: Omit<VideoAgentPlan, 'markdownDigest'> = {
      schemaVersion: 1,
      id: current.agentPlan?.id ?? randomUUID(),
      revision: (current.agentPlan?.revision ?? 0) + 1,
      status: 'active',
      title: input.title.trim(),
      request: input.request.trim(),
      assumptions: [...(input.assumptions ?? [])],
      // Provenance for the reader of plan.md. The conflict check uses the
      // execution log's cursor instead, so a plan written against an older
      // revision is not retroactively invalid.
      projectRevisionAtStart: current.revision + 1,
      createdAt,
      steps: structuredClone(input.steps),
    };
    const plan = withMarkdownDigest(base, current);
    return { ...current, agentPlan: plan };
  });
  await writeAgentPlanMarkdown(project);
  const plan = project.agentPlan!;
  // The user instruction that produced this plan is the durable record that a
  // human asked for the work.
  recordVideoIntentLog({
    projectId,
    userIntentText: plan.request,
    plan,
    accepted: true,
    diffSummary: `Wrote durable video plan ${plan.id} revision ${plan.revision}`,
    planId: plan.id,
    planRevision: plan.revision,
  });
  logger.info('video.agent.plan_written', {
    project_id: projectId,
    plan_id: plan.id,
    plan_revision: plan.revision,
    project_revision: plan.projectRevisionAtStart,
    step_count: plan.steps.length,
  });
  return readVideoAgentPlan(projectId);
}

export async function supersedeVideoAgentPlan(
  projectId: string,
): Promise<VideoAgentPlanReadResult> {
  const project = await updateProjectDocument(projectId, (current) => {
    if (!current.agentPlan) throw new Error('Video agent plan not found');
    const base: Omit<VideoAgentPlan, 'markdownDigest'> = {
      ...current.agentPlan,
      status: 'superseded',
    };
    return { ...current, agentPlan: withMarkdownDigest(base, current) };
  });
  await writeAgentPlanMarkdown(project);
  logger.info('video.agent.plan_superseded', {
    project_id: projectId,
    plan_id: project.agentPlan?.id,
    plan_revision: project.agentPlan?.revision,
  });
  return readVideoAgentPlan(projectId);
}

export async function readVideoAgentPlan(
  projectId: string,
): Promise<VideoAgentPlanReadResult> {
  const project = await getProject(projectId);
  const markdownPath = getVideoAgentPlanMarkdownPath(projectId);
  if (!project.agentPlan) return { markdownPath, drifted: false };
  const markdown = await fs.readFile(markdownPath, 'utf8').catch(() => '');
  const markdownDigest = digest(markdown);
  const drifted = markdownDigest !== project.agentPlan.markdownDigest;
  if (drifted) {
    logger.warn('video.agent.plan_drift_detected', {
      project_id: projectId,
      plan_id: project.agentPlan.id,
      plan_revision: project.agentPlan.revision,
    });
  }
  return {
    plan: project.agentPlan,
    markdownPath,
    markdownDigest,
    drifted,
  };
}

export function getVideoAgentPlanMarkdownPath(projectId: string): string {
  return path.join(getVideoProjectDir(projectId), 'agent', 'plan.md');
}

export function renderVideoAgentPlanMarkdown(
  plan: Omit<VideoAgentPlan, 'markdownDigest'> | VideoAgentPlan,
  project: VideoProject,
): string {
  const referencedAssets = project.assets.filter((asset) =>
    plan.steps.some((step) => JSON.stringify(step.inputs).includes(asset.id)),
  );
  const lines = [
    `# ${plan.title}`,
    '',
    `- Plan ID: \`${plan.id}\``,
    `- Plan revision: ${plan.revision}`,
    `- Status: ${plan.status}`,
    `- Written: ${plan.createdAt}`,
    `- Project revision when written: ${plan.projectRevisionAtStart}`,
    '',
    '## Original request',
    '',
    plan.request,
    '',
    '## Assumptions',
    '',
    ...(plan.assumptions.length > 0
      ? plan.assumptions.map((assumption) => `- ${assumption}`)
      : ['- None recorded.']),
    '',
    '## Asset selections',
    '',
    ...(referencedAssets.length > 0
      ? referencedAssets.map(
          (asset) => `- \`${asset.id}\` — ${assetDisplayName(asset)}`,
        )
      : ['- No project assets selected yet.']),
    '',
    '## Implementation steps',
    '',
  ];
  plan.steps.forEach((step, index) => {
    lines.push(
      `### ${index + 1}. ${step.title} (\`${step.id}\`)`,
      '',
      step.intent,
      '',
      `- Operation: \`${step.operation}\``,
      `- Depends on: ${step.dependsOn.length > 0 ? step.dependsOn.map((id) => `\`${id}\``).join(', ') : 'none'}`,
      '- Inputs:',
      '',
      '```json',
      JSON.stringify(redactPlanValue(step.inputs), null, 2),
      '```',
      '',
      '- Verification:',
      ...step.verification.map((item) => `  - ${item}`),
      `- Rollback: ${step.rollback}`,
      '',
    );
  });
  lines.push(
    '## Final gate',
    '',
    'Complete the final render verification, then require human review before publishing or destructive follow-up actions.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function writeAgentPlanMarkdown(project: VideoProject): Promise<void> {
  if (!project.agentPlan) return;
  const filePath = getVideoAgentPlanMarkdownPath(project.id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(
    tmpPath,
    renderVideoAgentPlanMarkdown(project.agentPlan, project),
  );
  await fs.rename(tmpPath, filePath);
}

function withMarkdownDigest(
  plan: Omit<VideoAgentPlan, 'markdownDigest'>,
  project: VideoProject,
): VideoAgentPlan {
  return {
    ...plan,
    markdownDigest: digest(renderVideoAgentPlanMarkdown(plan, project)),
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assetDisplayName(asset: MediaItem): string {
  return (
    asset.provenance?.sourceDisplayName ??
    (asset.path.startsWith('catalog:')
      ? asset.path.slice('catalog:'.length)
      : path.basename(asset.path))
  );
}

function redactPlanValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return path.isAbsolute(value) ? '[external path redacted]' : value;
  }
  if (Array.isArray(value)) return value.map(redactPlanValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactPlanValue(entry),
      ]),
    );
  }
  return value;
}
