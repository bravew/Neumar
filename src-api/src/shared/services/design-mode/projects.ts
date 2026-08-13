import fs from 'node:fs/promises';
import path from 'node:path';

import { nanoid } from 'nanoid';

import { getDatabase } from '@/shared/db';
import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import { resolveDesignSkillId } from './catalogs';
import { normalizeDesignContextPacks } from './context-packs';
import {
  appendProjectHistory,
  ensureProjectScaffold,
  getProjectDir,
  readProjectManifest,
  withProjectLock,
  writeProjectManifest,
} from './fs';
import { normalizeLinkedContextDirs } from './linked-context';
import { resolveDesignProjectLocationRoot } from './project-locations';
import {
  type CreateDesignProjectInput,
  type DesignOutput,
  type DesignProject,
  type PatchDesignProjectInput,
} from './types';

const logger = createLogger('DesignProjects');
const designSystemsLogger = createLogger('DesignSystems');

interface DesignProjectRow {
  id: string;
  surface: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function createDesignProject(
  input: CreateDesignProjectInput,
): Promise<DesignProject> {
  const now = new Date().toISOString();
  const defaults = readDesignModeProjectDefaults();
  const workspaceRoot = resolveDesignProjectLocationRoot(input.workspaceRoot);
  const skillId = await resolveDesignSkillId(
    input.skillId === undefined ? defaults.skillId : (input.skillId ?? null),
  );
  const title =
    input.title?.trim() ||
    `${surfaceTitle(input.surface)} · ${new Date().toLocaleDateString('en-CA')}`;
  const project: DesignProject = {
    id: `design_${nanoid(12)}`,
    title,
    workspaceRoot,
    surface: input.surface,
    intent: input.intent ?? 'other',
    status: 'draft',
    customInstructions: input.customInstructions?.trim() || undefined,
    skillId,
    designSystemId:
      input.designSystemId === undefined
        ? defaults.designSystemId
        : (input.designSystemId ?? null),
    inspirationDesignSystemIds: input.inspirationDesignSystemIds ?? [],
    craftRefs: [],
    linkedContextDirs: normalizeLinkedContextDirs(
      input.linkedContextDirs ?? [],
      workspaceRoot,
    ),
    contextPacks: normalizeDesignContextPacks(input.contextPacks ?? []),
    brief: input.brief ?? {},
    media: input.media,
    budget: input.budget,
    promptTemplate: input.promptTemplate,
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
  await ensureProjectScaffold(project);
  upsertProjectIndex(project);
  await appendProjectHistory(project.id, {
    type: 'project.created',
    at: now,
    projectId: project.id,
    surface: project.surface,
  });
  if (isDesignSystemNewConversation(project)) {
    designSystemsLogger.info('design_system_new_conversation', {
      designSystemId: project.designSystemId,
      origin: 'project-create',
    });
  }
  logger.info(`Created DesignMode project ${project.id} (${project.surface})`);
  return project;
}

export async function listDesignProjects(): Promise<DesignProject[]> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, surface, title, status, created_at, updated_at
       FROM design_projects
       ORDER BY updated_at DESC`,
    )
    .all() as DesignProjectRow[];
  const projects: DesignProject[] = [];
  for (const row of rows) {
    try {
      projects.push(await readProjectManifest(row.id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.debug(
          `Skipping DesignMode project index row with missing manifest: ${row.id}`,
        );
        continue;
      }
      logger.warn(
        `Design project index row has no readable manifest: ${row.id}`,
        error,
      );
    }
  }
  return projects;
}

export async function getDesignProject(id: string): Promise<DesignProject> {
  return readProjectManifest(id);
}

async function applyDesignProjectPatch(
  id: string,
  patch: PatchDesignProjectInput,
): Promise<DesignProject> {
  const current = await readProjectManifest(id);
  const now = new Date().toISOString();
  const skillId =
    patch.skillId === undefined
      ? current.skillId
      : await resolveDesignSkillId(patch.skillId ?? null);
  const next: DesignProject = {
    ...current,
    ...patch,
    skillId,
    designSystemId:
      patch.designSystemId === undefined
        ? current.designSystemId
        : (patch.designSystemId ?? null),
    linkedContextDirs:
      patch.linkedContextDirs === undefined
        ? current.linkedContextDirs
        : normalizeLinkedContextDirs(patch.linkedContextDirs),
    contextPacks:
      patch.contextPacks === undefined
        ? current.contextPacks
        : normalizeDesignContextPacks(patch.contextPacks),
    promptTemplate:
      patch.promptTemplate === null
        ? undefined
        : patch.promptTemplate === undefined
          ? current.promptTemplate
          : patch.promptTemplate,
    updatedAt: now,
  };
  await writeProjectManifest(next);
  upsertProjectIndex(next);
  await appendProjectHistory(id, {
    type: 'project.updated',
    at: now,
    patch: Object.keys(patch),
  });
  return next;
}

export async function patchDesignProject(
  id: string,
  patch: PatchDesignProjectInput,
): Promise<DesignProject> {
  return withProjectLock(id, () => applyDesignProjectPatch(id, patch));
}

export async function touchDesignProject(id: string): Promise<DesignProject> {
  return patchDesignProject(id, {});
}

export async function deleteDesignProject(id: string): Promise<void> {
  const project = await readProjectManifest(id);
  const projectDir = getProjectDir(id);
  const deletedAt = new Date().toISOString();
  const tombstone = path.join(projectDir, '.deleted');
  await appendProjectHistory(id, {
    type: 'project.deleted',
    at: deletedAt,
    projectId: id,
  });
  await fs.writeFile(tombstone, deletedAt, 'utf-8');
  const deletedRoot = path.join(path.dirname(projectDir), '.deleted');
  const deletedDir = path.join(
    deletedRoot,
    `${id}-${deletedAt.replace(/[:.]/g, '-')}`,
  );
  const db = getDatabase();
  db.prepare('DELETE FROM design_projects WHERE id = ?').run(id);
  try {
    await fs.mkdir(deletedRoot, { recursive: true });
    await fs.rename(projectDir, deletedDir);
    logger.info(
      `Deleted DesignMode project ${project.id} from index and moved files to ${deletedDir}`,
    );
  } catch (error) {
    logger.warn(
      `Deleted DesignMode project ${project.id} from index but could not move files`,
      error,
    );
  }
}

export async function addProjectOutput(
  projectId: string,
  output: DesignOutput,
): Promise<DesignProject> {
  return withProjectLock(projectId, async () => {
    const project = await readProjectManifest(projectId);
    return applyDesignProjectPatch(projectId, {
      outputs: [
        output,
        ...project.outputs.filter((item) => item.id !== output.id),
      ],
      status: 'complete',
    });
  });
}

export function upsertProjectIndex(project: DesignProject): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO design_projects
      (id, surface, title, status, created_at, updated_at)
     VALUES
      (@id, @surface, @title, @status, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
      surface = excluded.surface,
      title = excluded.title,
      status = excluded.status,
      updated_at = excluded.updated_at`,
  ).run(project);
}

function surfaceTitle(surface: string): string {
  return surface
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function readDesignModeProjectDefaults(): {
  skillId: string | null;
  designSystemId: string | null;
} {
  const raw = getSetting('designMode');
  if (!raw) {
    return { skillId: null, designSystemId: null };
  }
  try {
    const parsed = JSON.parse(raw) as {
      defaultSkillId?: unknown;
      defaultDesignSystemId?: unknown;
    };
    return {
      skillId: nonEmptyString(parsed.defaultSkillId),
      designSystemId: nonEmptyString(parsed.defaultDesignSystemId),
    };
  } catch {
    return { skillId: null, designSystemId: null };
  }
}

function isDesignSystemNewConversation(project: DesignProject): boolean {
  return Boolean(
    project.designSystemId &&
    project.brief &&
    project.brief.createdFromDesignSystem === true,
  );
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
