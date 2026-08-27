import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase } from '@/shared/db';
import { writeVideoAgentPlan } from '@/shared/video/agent-plan';
import {
  appendVideoExecutionLog,
  getVideoExecutionLogPath,
  readVideoExecutionLog,
  runLoggedVideoOperation,
  runLoggedVideoRollback,
} from '@/shared/video/execution-log';
import {
  createProject,
  getProject,
  updateProjectDocument,
} from '@/shared/video/store';

describe('Video execution log', () => {
  let workDir: string;
  let projectId: string;

  beforeEach(async () => {
    closeDatabase();
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-execution-log-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    projectId = (
      await createProject({ name: 'Logged project', template: 'custom' })
    ).id;
  });

  afterEach(async () => {
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('appends ordered started and terminal records without leaking paths', async () => {
    const identity = logIdentity('/Volumes/External/master.mp4');
    await appendVideoExecutionLog(projectId, {
      ...identity,
      phase: 'started',
    });
    await appendVideoExecutionLog(projectId, {
      ...identity,
      phase: 'succeeded',
      projectRevisionAfter: 2,
      result: { filePath: '/Volumes/External/master.mp4' },
    });

    const records = await readVideoExecutionLog(projectId);
    const raw = await fs.readFile(getVideoExecutionLogPath(projectId), 'utf8');

    expect(records.map((record) => [record.sequence, record.phase])).toEqual([
      [1, 'started'],
      [2, 'succeeded'],
    ]);
    expect(raw).not.toContain('/Volumes/External');
    expect(records[1]?.result).toEqual({
      filePath: '[absolute path redacted]',
    });
  });

  it('keeps prior records when the active file ends with a truncated line', async () => {
    await appendVideoExecutionLog(projectId, {
      ...logIdentity('safe'),
      phase: 'started',
    });
    await fs.appendFile(
      getVideoExecutionLogPath(projectId),
      '{"schemaVersion":',
    );

    await expect(readVideoExecutionLog(projectId)).resolves.toHaveLength(1);
  });

  it('rolls the active file while preserving replay sequence', async () => {
    for (let index = 0; index < 4; index += 1) {
      await appendVideoExecutionLog(
        projectId,
        {
          ...logIdentity(`input-${index}-${'x'.repeat(100)}`),
          phase: index % 2 === 0 ? 'started' : 'succeeded',
        },
        { maxBytes: 450 },
      );
    }

    const agentDir = path.dirname(getVideoExecutionLogPath(projectId));
    const files = await fs.readdir(agentDir);
    expect(files).toEqual(
      expect.arrayContaining(['execution-log.1.jsonl', 'execution-log.jsonl']),
    );
    expect(
      (await readVideoExecutionLog(projectId)).map((row) => row.sequence),
    ).toEqual([1, 2, 3, 4]);
  });

  it('leaves a started record durable when execution is interrupted', async () => {
    await appendVideoExecutionLog(projectId, {
      ...logIdentity('crash'),
      phase: 'started',
    });

    const records = await readVideoExecutionLog(projectId);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ phase: 'started', stepId: 'step-1' });
  });

  it('wraps an approved plan operation and links new journal ids', async () => {
    await writeVideoAgentPlan(projectId, {
      title: 'Inspect',
      request: 'Inspect the project.',
      steps: [
        {
          id: 'inspect',
          title: 'Inspect',
          intent: 'Inspect project state.',
          dependsOn: [],
          operation: 'video_get_project_summary',
          inputs: {},
          verification: ['Summary returned.'],
          rollback: 'No rollback is required.',
        },
      ],
    });

    const result = await runLoggedVideoOperation({
      projectId,
      operation: 'video_get_project_summary',
      operationInput: { projectId },
      execute: async () => ({
        content: [{ type: 'text', text: '{"ok":true}' }],
      }),
    });

    expect(result).toMatchObject({ content: [{ type: 'text' }] });
    expect(
      (await readVideoExecutionLog(projectId)).map((row) => row.phase),
    ).toEqual(['started', 'succeeded']);
    expect((await getProject(projectId)).agentPlan?.status).toBe('active');
  });

  it('logs rollback as its own durable terminal phase', async () => {
    await writeVideoAgentPlan(projectId, {
      title: 'Rollback',
      request: 'Apply and possibly roll back an edit.',
      steps: [
        {
          id: 'edit',
          title: 'Edit',
          intent: 'Apply a reversible edit.',
          dependsOn: [],
          operation: 'video_set_caption',
          inputs: {},
          verification: ['Caption is correct.'],
          rollback: 'Undo the linked journal entry.',
        },
      ],
    });

    await runLoggedVideoRollback({
      projectId,
      journalEntryId: 'journal-1',
      execute: async () => {
        await updateProjectDocument(projectId, (project) => ({
          ...project,
          name: 'Rolled back project',
        }));
        return { ok: true };
      },
    });

    expect((await readVideoExecutionLog(projectId)).slice(-2)).toMatchObject([
      { phase: 'started', operation: 'video_rollback_agent_journal_entry' },
      {
        phase: 'rolled-back',
        journalEntryIds: ['journal-1'],
        verification: { journalEntryState: 'undone' },
      },
    ]);
  });

  function logIdentity(seed: string) {
    const encodedSeed = Buffer.from(seed).toString('hex');
    return {
      runId: 'run-1',
      planId: 'plan-1',
      planRevision: 1,
      stepId: 'step-1',
      attempt: 1,
      operation: 'video_attach_asset',
      idempotencyKey: `key-${encodedSeed}`,
      inputDigest: `digest-${encodedSeed}`,
      projectRevisionBefore: 1,
    };
  }
});
