import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode routines', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(
      path.join(os.tmpdir(), 'neuma-design-routines-home-'),
    );
    workDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'neuma-design-routines-work-'),
    );
    vi.stubEnv('HOME', tempHome);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('workDir', workDir);
  });

  afterEach(async () => {
    const { closeDatabase } = await import('@/shared/db');
    const { stopDesignRoutineScheduler } =
      await import('@/shared/services/design-mode/routines');
    stopDesignRoutineScheduler();
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('creates and runs a manual routine through DesignMode routes', async () => {
    const { designRoutes } = await import('@/app/api/design');

    const created = await designRoutes.request('/routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Morning brief',
        prompt: 'Create a concise launch brief.',
        surface: 'document',
        targetMode: 'new_project',
        schedule: { kind: 'manual' },
      }),
    });
    expect(created.status).toBe(201);
    const createdData = (await created.json()) as {
      routine: { id: string; nextRunAt: string | null };
    };
    expect(createdData.routine.nextRunAt).toBeNull();

    const started = await designRoutes.request(
      `/routines/${createdData.routine.id}/run`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ waitForCompletion: true }),
      },
    );
    expect(started.status).toBe(202);
    const runData = (await started.json()) as {
      run: {
        id: string;
        status: string;
        projectId: string | null;
        taskId: string | null;
      };
    };
    expect(runData.run).toMatchObject({
      status: 'succeeded',
      projectId: expect.stringMatching(/^design_/),
      taskId: expect.stringMatching(/^dmtask_/),
    });

    const { getDatabase } = await import('@/shared/db');
    const { listDesignRoutines } =
      await import('@/shared/services/design-mode/routines');
    getDatabase()
      .prepare('UPDATE design_routine_runs SET error = ? WHERE id = ?')
      .run('Provider returned $&', runData.run.id);
    expect(listDesignRoutines()[0].lastRunError).toBe('Provider returned $&');

    const runs = await designRoutes.request(
      `/routines/${createdData.routine.id}/runs`,
    );
    await expect(runs.json()).resolves.toMatchObject({
      runs: [expect.objectContaining({ status: 'succeeded' })],
    });
  });

  it('calculates DST-aware next runs without duplicate fallback fires', async () => {
    const { computeNextRoutineRun } =
      await import('@/shared/services/design-mode/routine-schedule');

    const spring = computeNextRoutineRun(
      { kind: 'daily', time: '02:30', timezone: 'America/New_York' },
      { after: new Date('2026-03-08T06:00:00.000Z') },
    );
    expect(spring.nextRunAt).toBe('2026-03-08T07:00:00.000Z');
    expect(spring.dstSkipped).toBe(true);

    const firstFall = computeNextRoutineRun(
      { kind: 'daily', time: '01:30', timezone: 'America/New_York' },
      { after: new Date('2026-11-01T04:00:00.000Z') },
    );
    expect(firstFall.nextRunAt).toBe('2026-11-01T05:30:00.000Z');

    const secondFall = computeNextRoutineRun(
      { kind: 'daily', time: '01:30', timezone: 'America/New_York' },
      {
        after: new Date('2026-11-01T05:31:00.000Z'),
        lastFiredUtc: firstFall.nextRunAt,
      },
    );
    expect(secondFall.nextRunAt).toBe('2026-11-02T06:30:00.000Z');
  });

  it('claims a scheduled routine slot only once', async () => {
    const {
      claimDesignRoutineScheduleSlot,
      createDesignRoutine,
      getDesignRoutine,
    } = await import('@/shared/services/design-mode/routines');

    const routine = await createDesignRoutine({
      name: 'Daily hero',
      prompt: 'Generate the latest hero variant.',
      surface: 'prototype',
      targetMode: 'new_project',
      enabled: true,
      projectId: null,
      designSystemId: null,
      skillId: null,
      craftRefs: [],
      providerProfileId: null,
      schedule: { kind: 'daily', time: '09:00', timezone: 'UTC' },
    });
    expect(routine.nextRunAt).not.toBeNull();

    const tickTime = new Date(Date.parse(routine.nextRunAt!) + 1000);
    expect(claimDesignRoutineScheduleSlot(routine, tickTime, true)).toBe(true);
    expect(claimDesignRoutineScheduleSlot(routine, tickTime, true)).toBe(false);

    const claimed = getDesignRoutine(routine.id);
    expect(claimed.lastFiredAt).toBe(tickTime.toISOString());
    expect(claimed.nextRunAt).not.toBe(routine.nextRunAt);
  });

  it('rejects routines with unknown skills', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignRoutine, updateDesignRoutine } =
      await import('@/shared/services/design-mode/routines');

    const rejectedCreate = await designRoutes.request('/routines', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Invalid skill routine',
        prompt: 'Generate an invalid skill routine.',
        surface: 'prototype',
        targetMode: 'new_project',
        skillId: 'missing-skill',
        schedule: { kind: 'manual' },
      }),
    });
    expect(rejectedCreate.status).toBe(400);
    await expect(rejectedCreate.json()).resolves.toMatchObject({
      error: 'Unknown DesignMode skill: missing-skill',
    });

    const routine = await createDesignRoutine({
      name: 'Skill routine',
      prompt: 'Generate a valid skill routine.',
      surface: 'prototype',
      targetMode: 'new_project',
      enabled: true,
      projectId: null,
      designSystemId: null,
      skillId: 'mobile-app',
      craftRefs: [],
      providerProfileId: null,
      schedule: { kind: 'manual' },
    });
    expect(routine.skillId).toBe('bundled:mobile-app');

    await expect(
      updateDesignRoutine(routine.id, { skillId: 'missing-skill' }),
    ).rejects.toThrow(/Unknown DesignMode skill: missing-skill/);

    const rejectedPatch = await designRoutes.request(
      `/routines/${routine.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillId: 'missing-skill' }),
      },
    );
    expect(rejectedPatch.status).toBe(400);
    await expect(rejectedPatch.json()).resolves.toMatchObject({
      error: 'Unknown DesignMode skill: missing-skill',
    });
  });

  it('redacts secrets, paths, and identity before serialization', async () => {
    const { redactDesignTelemetryPayload } =
      await import('@/shared/services/design-mode/redact');
    const redacted = redactDesignTelemetryPayload(
      {
        apiKey: 'sk-ant-secret-token',
        auth: 'Authorization: Bearer eyJabc.def.ghi',
        github: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
        aws: 'AKIAABCDEFGHIJKLMNOP',
        slack: 'xoxb-123-456-secret',
        path: `${workDir}/project/artifact.html`,
        outsidePath: '/Users/alice/.ssh/id_rsa',
        email: 'alice@example.com',
        longText: 'x'.repeat(4100),
      },
      { workspaceRoot: workDir, sendIdentity: false },
    );
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('sk-ant-secret-token');
    expect(serialized).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
    expect(serialized).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(serialized).not.toContain('xoxb-123-456-secret');
    expect(serialized).not.toContain(workDir);
    expect(serialized).not.toContain('/Users/alice');
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).toContain('<workspace>/project/artifact.html');
    expect(serialized).toContain('<redacted:email>');
    expect(serialized).toContain('<truncated:');
  });
});
