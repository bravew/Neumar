import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { RunMode } from '@/core/agent/runtime-state';

import { getSetting, getTask } from '@/shared/db/operations';
import { loadAllSkills, type LoadedSkill } from '@/shared/plugins';
import { isSupplementalSkillSelectionEnabled } from '@/shared/rollout/multi-mode-reliability';
import { getProjectDir } from '@/shared/services/design-mode/fs';
import { resolveDesignProjectLocationRoot } from '@/shared/services/design-mode/project-locations';
import { getDesignProject } from '@/shared/services/design-mode/projects';
import {
  getProject,
  getVideoProjectDir,
  getVideoProjectRoot,
} from '@/shared/video/store';

const skillIdSchema = z.string().regex(/^[\w][\w.:-]*$/);

export const RecoveryActionSchema = z.enum([
  'retry',
  'continue',
  'answer_question',
  'switch_runtime',
  'resume_after_restart',
]);

export const RunContextEnvelopeInputSchema = z
  .object({
    mode: z.enum(['task', 'design', 'video']).optional(),
    projectId: z.string().min(1).nullable().optional(),
    conversationId: z.string().min(1).nullable().optional(),
    clientRequestId: z.string().min(1).max(200).optional(),
    messageId: z.string().min(1).max(200).optional(),
    supplementalSkillIds: z.array(skillIdSchema).max(3).optional(),
    recovery: z
      .object({
        executionId: z.string().min(1).max(200),
        sourceRunId: z.string().min(1).max(200),
        action: RecoveryActionSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export type RunContextEnvelopeInput = z.infer<
  typeof RunContextEnvelopeInputSchema
>;

export interface NormalizedRunContextEnvelope {
  mode: RunMode;
  ownerKey: string;
  projectId: string | null;
  conversationId: string | null;
  clientRequestId: string;
  messageId: string;
  supplementalSkillIds: string[];
  projectRoot: string | null;
  recovery?: {
    executionId: string;
    sourceRunId: string;
    action: z.infer<typeof RecoveryActionSchema>;
  };
}

export class RunContextError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
    this.name = 'RunContextError';
  }
}

function dedupeSkillIds(
  supplementalSkillIds: readonly string[],
  legacyPinnedSkills: readonly string[],
): string[] {
  const ids = [...new Set([...supplementalSkillIds, ...legacyPinnedSkills])];
  if (ids.length > 3) {
    throw new RunContextError(
      'At most three supplemental skills may be selected',
      400,
    );
  }
  const parsed = z.array(skillIdSchema).max(3).safeParse(ids);
  if (!parsed.success) {
    throw new RunContextError('Invalid supplemental skill id', 400);
  }
  return parsed.data;
}

function modeSupportsSkill(mode: RunMode, skill: LoadedSkill): boolean {
  if (skill.metadata.modes) return skill.metadata.modes.includes(mode);
  return mode !== 'video';
}

export async function validateSupplementalSkills(
  mode: RunMode,
  ids: readonly string[],
  availableSkills?: readonly LoadedSkill[],
): Promise<void> {
  if (ids.length === 0) return;
  const skills = availableSkills ?? (await loadAllSkills({ watch: false }));
  const byId = new Map<string, LoadedSkill>();
  for (const skill of skills) {
    byId.set(skill.name, skill);
    if (!byId.has(skill.bareName)) byId.set(skill.bareName, skill);
  }
  for (const id of ids) {
    const skill = byId.get(id);
    if (!skill) {
      throw new RunContextError(`Unknown or disabled skill: ${id}`, 400);
    }
    if (!modeSupportsSkill(mode, skill)) {
      throw new RunContextError(
        `Skill ${id} is not available in ${mode} mode`,
        400,
      );
    }
  }
}

function assertEnvelopeAuthority(
  input: RunContextEnvelopeInput,
  mode: RunMode,
  ownerKey: string,
): void {
  if (input.mode && input.mode !== mode) {
    throw new RunContextError('Run mode does not match the route', 409);
  }
  if (mode === 'task') {
    if (input.projectId) {
      throw new RunContextError('Task run context cannot claim a project', 409);
    }
    if (input.conversationId && input.conversationId !== ownerKey) {
      throw new RunContextError(
        'Conversation id does not match the Task route owner',
        409,
      );
    }
    return;
  }
  if (input.projectId && input.projectId !== ownerKey) {
    throw new RunContextError('Project id does not match the route owner', 409);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

async function canonicalContainedProjectRoot(
  workspaceRoot: string,
  projectRoot: string,
): Promise<string> {
  const canonicalWorkspace = await canonicalPath(workspaceRoot);
  const canonicalProject = await canonicalPath(projectRoot);
  if (!isWithin(canonicalWorkspace, canonicalProject)) {
    throw new RunContextError(
      'Project root escapes its configured workspace',
      409,
    );
  }
  return canonicalProject;
}

async function canonicalPath(candidate: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(candidate);
    if (parent === candidate) throw error;
    return path.join(await canonicalPath(parent), path.basename(candidate));
  }
}

async function resolveOwner(
  mode: RunMode,
  ownerKey: string,
  effectiveWorkDir?: string,
): Promise<{
  projectId: string | null;
  conversationId: string | null;
  projectRoot: string | null;
}> {
  if (mode === 'task') {
    const task = getTask(ownerKey);
    if (!task) throw new RunContextError('Task conversation not found', 404);
    // Must match the root the run itself resolves (ag-ui.ts's `effectiveWorkDir`
    // — the per-request workDir override, falling back to the global setting).
    // `withWorkDirSync` persists `task.work_dir` from whichever root the CLI
    // actually ran under; validating against a different root here would
    // reject a task's own on-disk session folder on every later message.
    const workspaceRoot = effectiveWorkDir ?? getSetting('workDir');
    const projectRoot =
      workspaceRoot && task.work_dir
        ? await canonicalContainedProjectRoot(workspaceRoot, task.work_dir)
        : (task.work_dir ?? null);
    return {
      projectId: null,
      conversationId: ownerKey,
      projectRoot,
    };
  }
  if (mode === 'design') {
    try {
      const project = await getDesignProject(ownerKey);
      const workspaceRoot = resolveDesignProjectLocationRoot(
        project.workspaceRoot,
      );
      return {
        projectId: ownerKey,
        conversationId: null,
        projectRoot: await canonicalContainedProjectRoot(
          workspaceRoot,
          getProjectDir(ownerKey, project.workspaceRoot),
        ),
      };
    } catch (error) {
      if (error instanceof RunContextError) throw error;
      throw new RunContextError('Design project not found', 404);
    }
  }
  try {
    await getProject(ownerKey);
    return {
      projectId: ownerKey,
      conversationId: null,
      projectRoot: await canonicalContainedProjectRoot(
        getVideoProjectRoot(ownerKey),
        getVideoProjectDir(ownerKey),
      ),
    };
  } catch (error) {
    if (error instanceof RunContextError) throw error;
    throw new RunContextError('Video project not found', 404);
  }
}

/** Assert that an owner exists without accepting client-supplied authority. */
export async function assertRunOwnerExists(
  mode: RunMode,
  ownerKey: string,
): Promise<void> {
  await resolveOwner(mode, ownerKey);
}

export async function resolveRunContext(input: {
  mode: RunMode;
  ownerKey: string;
  envelope?: unknown;
  legacyPinnedSkills?: readonly string[];
  availableSkills?: readonly LoadedSkill[];
  /** Per-request workDir override (task mode only) — see {@link resolveOwner}. */
  effectiveWorkDir?: string;
}): Promise<NormalizedRunContextEnvelope> {
  const parsed = RunContextEnvelopeInputSchema.safeParse(input.envelope ?? {});
  if (!parsed.success) {
    throw new RunContextError('Invalid run context envelope', 400);
  }
  assertEnvelopeAuthority(parsed.data, input.mode, input.ownerKey);
  const supplementalSkillIds = isSupplementalSkillSelectionEnabled()
    ? dedupeSkillIds(
        parsed.data.supplementalSkillIds ?? [],
        input.legacyPinnedSkills ?? [],
      )
    : [];
  await validateSupplementalSkills(
    input.mode,
    supplementalSkillIds,
    input.availableSkills,
  );
  const owner = await resolveOwner(
    input.mode,
    input.ownerKey,
    input.effectiveWorkDir,
  );
  return {
    mode: input.mode,
    ownerKey: input.ownerKey,
    projectId: owner.projectId,
    conversationId: owner.conversationId,
    clientRequestId: parsed.data.clientRequestId ?? randomUUID(),
    messageId: parsed.data.messageId ?? randomUUID(),
    supplementalSkillIds,
    projectRoot: owner.projectRoot,
    ...(parsed.data.recovery ? { recovery: parsed.data.recovery } : {}),
  };
}
