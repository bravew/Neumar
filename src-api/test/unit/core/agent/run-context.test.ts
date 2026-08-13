import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveRunContext,
  RunContextError,
  validateSupplementalSkills,
} from '@/core/agent/run-context';

import { getDatabase } from '@/shared/db';
import {
  createSession,
  createTask,
  deleteTask,
  setSetting,
} from '@/shared/db/operations';
import type { LoadedSkill } from '@/shared/plugins';

function skill(
  name: string,
  modes?: LoadedSkill['metadata']['modes'],
): LoadedSkill {
  return {
    name,
    bareName: name,
    plugin: null,
    path: `/skills/${name}`,
    metadata: { name, description: `${name} skill`, modes },
    content: '',
  };
}

describe('run context boundary', () => {
  let workspaceRoot: string;
  let taskRoot: string;
  let taskId: string;
  let sessionId: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'neuma-run-context-'));
    taskRoot = join(workspaceRoot, 'sessions', 'task');
    await mkdir(taskRoot, { recursive: true });
    taskId = `task-${crypto.randomUUID()}`;
    sessionId = `session-${crypto.randomUUID()}`;
    setSetting('workDir', workspaceRoot);
    createSession({ id: sessionId, prompt: 'Run context test' });
    createTask({
      id: taskId,
      session_id: sessionId,
      task_index: 0,
      prompt: 'Run context test',
      work_dir: taskRoot,
    });
  });

  afterEach(async () => {
    delete process.env.NEUMA_SUPPLEMENTAL_SKILLS_ENABLED;
    deleteTask(taskId);
    getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('normalizes omitted ids and both Task skill spellings', async () => {
    const context = await resolveRunContext({
      mode: 'task',
      ownerKey: taskId,
      envelope: { supplementalSkillIds: ['review'] },
      legacyPinnedSkills: ['review', 'docs'],
      availableSkills: [skill('review'), skill('docs')],
    });

    expect(context).toMatchObject({
      mode: 'task',
      ownerKey: taskId,
      projectId: null,
      conversationId: taskId,
      supplementalSkillIds: ['review', 'docs'],
      projectRoot: await realpath(taskRoot),
    });
    expect(context.clientRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(context.messageId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('rejects stale owners, route mismatches, and over-cap skill unions', async () => {
    await expect(
      resolveRunContext({
        mode: 'task',
        ownerKey: 'missing-task',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      resolveRunContext({
        mode: 'task',
        ownerKey: taskId,
        envelope: { conversationId: 'different-task' },
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      resolveRunContext({
        mode: 'task',
        ownerKey: taskId,
        envelope: { supplementalSkillIds: ['one', 'two'] },
        legacyPinnedSkills: ['three', 'four'],
      }),
    ).rejects.toBeInstanceOf(RunContextError);
  });

  it('requires explicit Video compatibility metadata', async () => {
    await expect(
      validateSupplementalSkills('video', ['legacy'], [skill('legacy')]),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      validateSupplementalSkills(
        'video',
        ['video-safe'],
        [skill('video-safe', ['video'])],
      ),
    ).resolves.toBeUndefined();
  });

  it('drops supplemental selections when the compatibility flag is off', async () => {
    process.env.NEUMA_SUPPLEMENTAL_SKILLS_ENABLED = 'false';
    const context = await resolveRunContext({
      mode: 'task',
      ownerKey: taskId,
      envelope: { supplementalSkillIds: ['unknown-is-ignored'] },
      legacyPinnedSkills: ['also-ignored'],
      availableSkills: [],
    });

    expect(context.supplementalSkillIds).toEqual([]);
  });

  it('validates against the per-request workDir, not just the global setting', async () => {
    // Reproduces the task-bricking bug: a task's session folder was created
    // under the per-request `effectiveWorkDir` (frontend override / desktop
    // sidecar default), which can differ from the backend's global `workDir`
    // setting. Validating against the global setting alone rejects the
    // task's own on-disk folder on every message after the first.
    const otherWorkspaceRoot = await mkdtemp(
      join(tmpdir(), 'neuma-run-context-other-'),
    );
    const otherTaskRoot = join(otherWorkspaceRoot, 'sessions', 'task');
    await mkdir(otherTaskRoot, { recursive: true });
    getDatabase()
      .prepare('UPDATE tasks SET work_dir = ? WHERE id = ?')
      .run(otherTaskRoot, taskId);

    // Global setting (`workspaceRoot`) does not contain `otherTaskRoot` —
    // without the per-request override this must reject.
    await expect(
      resolveRunContext({ mode: 'task', ownerKey: taskId }),
    ).rejects.toMatchObject({ status: 409 });

    // With the per-request effectiveWorkDir matching where the task's
    // folder actually lives, the same task now resolves successfully.
    const context = await resolveRunContext({
      mode: 'task',
      ownerKey: taskId,
      effectiveWorkDir: otherWorkspaceRoot,
    });
    expect(context.projectRoot).toBe(await realpath(otherTaskRoot));

    await rm(otherWorkspaceRoot, { recursive: true, force: true });
  });

  it('rejects a task root symlink that escapes the configured workspace', async () => {
    const outsideRoot = await mkdtemp(
      join(tmpdir(), 'neuma-run-context-outside-'),
    );
    const linkPath = join(workspaceRoot, 'escaped-task');
    await symlink(outsideRoot, linkPath);
    getDatabase()
      .prepare('UPDATE tasks SET work_dir = ? WHERE id = ?')
      .run(linkPath, taskId);

    await expect(
      resolveRunContext({ mode: 'task', ownerKey: taskId }),
    ).rejects.toMatchObject({ status: 409 });
    await rm(outsideRoot, { recursive: true, force: true });
  });
});
