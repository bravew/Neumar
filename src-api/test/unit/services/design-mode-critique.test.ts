import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CritiquePanelistAdapterContext } from '@/shared/services/design-mode/critique/adapters/types';

describe('DesignMode Design Jury', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-jury-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-jury-work-'));
    vi.stubEnv('HOME', tempHome);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('workDir', workDir);
  });

  afterEach(async () => {
    const { __resetCritiqueAdapterRegistry } =
      await import('@/shared/services/design-mode/critique/adapters/registry');
    __resetCritiqueAdapterRegistry();
    const { clearDesignJuryRunRegistryForTest } =
      await import('@/shared/services/design-mode/critique/run-registry');
    clearDesignJuryRunRegistryForTest();
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('is disabled by default', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { runDesignJury, DesignJuryDisabledError } =
      await import('@/shared/services/design-mode/critique/design-jury');
    const project = await createDesignProject({
      title: 'Disabled jury',
      surface: 'prototype',
    });

    await expect(runDesignJury(project.id)).rejects.toBeInstanceOf(
      DesignJuryDisabledError,
    );
  });

  it('honors the designModeJuryEnabled DB setting as a fallback', async () => {
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('designModeJuryEnabled', 'true');
    const { isDesignJuryEnabled } =
      await import('@/shared/services/design-mode/critique/design-jury');
    expect(isDesignJuryEnabled()).toBe(true);
  });

  it('persists a bounded transcript and role scores when enabled', async () => {
    vi.stubEnv('DESIGN_MODE_JURY_ENABLED', 'true');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { listDesignJuryRuns, runDesignJury } =
      await import('@/shared/services/design-mode/critique/design-jury');
    const { readDesignJuryPanelEvents } =
      await import('@/shared/services/design-mode/critique/events');
    const project = await createDesignProject({
      title: 'Jury target',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      `
      <main>
        <section>
          <h1>Launch operations dashboard</h1>
          <button>Submit</button>
          <img src="hero.png">
        </section>
      </main>
      `,
    );

    const run = await runDesignJury(project.id, {
      artifactPath: 'artifacts/index.html',
    });

    expect(run.protocolVersion).toBe('design-jury.v1');
    expect(run.artifactRef).toMatchObject({
      runId: run.id,
      mediaType: 'text/html',
      url: `/design/projects/${encodeURIComponent(project.id)}/design-jury/${encodeURIComponent(run.id)}/artifact`,
    });
    expect(run.artifactRef?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.roles.map((role) => role.role)).toEqual([
      'designer',
      'critic',
      'brand',
      'accessibility',
      'copy',
    ]);
    expect(run.mustFix.length).toBeGreaterThan(0);
    await expect(
      fs.readFile(
        resolveProjectPath(project.id, run.transcriptPath).absolutePath,
        'utf-8',
      ),
    ).resolves.toContain('"schema": "design-jury.v1"');
    await expect(listDesignJuryRuns(project.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: run.id,
          artifactRef: expect.objectContaining({
            sha256: run.artifactRef?.sha256,
          }),
        }),
      ]),
    );
    await expect(
      readDesignJuryPanelEvents(project.id, run.id),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'run_started', runId: run.id }),
        expect.objectContaining({
          type: 'panelist_dim',
          runId: run.id,
          role: 'designer',
        }),
        expect.objectContaining({ type: 'round_end', runId: run.id }),
        expect.objectContaining({ type: 'shipped', runId: run.id }),
      ]),
    );
  });

  it('falls back to the same-role degraded adapter once on primary failure', async () => {
    vi.stubEnv('DESIGN_MODE_JURY_ENABLED', 'true');
    const { __resetCritiqueAdapterRegistry, registerCritiqueAdapter } =
      await import('@/shared/services/design-mode/critique/adapters/registry');
    const { DESIGN_JURY_ROLE_ORDER } =
      await import('@/shared/services/design-mode/critique/protocol');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { runDesignJury } =
      await import('@/shared/services/design-mode/critique/design-jury');
    const { readDesignJuryPanelEvents } =
      await import('@/shared/services/design-mode/critique/events');
    const calls: string[] = [];

    __resetCritiqueAdapterRegistry(false);
    for (const role of DESIGN_JURY_ROLE_ORDER) {
      registerCritiqueAdapter({
        id: `test-primary-${role}`,
        role,
        capability: 'primary',
        async run(context) {
          calls.push(`primary:${context.role}`);
          if (context.role === 'designer') {
            return {
              ok: false,
              reason: 'timeout',
              fallback: 'test-degraded-designer',
            };
          }
          return {
            ok: true,
            transcript: transcriptFromContext(context, []),
          };
        },
      });
      registerCritiqueAdapter({
        id: `test-degraded-${role}`,
        role,
        capability: 'degraded',
        async run(context) {
          calls.push(`degraded:${context.role}`);
          return {
            ok: true,
            transcript: transcriptFromContext(
              context,
              [`degraded:${context.fallbackReason ?? 'unknown'}`],
              context.role === 'designer' ? 3 : context.roleScore.score,
            ),
          };
        },
      });
    }

    const project = await createDesignProject({
      title: 'Adapter fallback',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main><h1>Launch operations dashboard</h1><button>Submit</button></main>',
    );

    const run = await runDesignJury(project.id, {
      artifactPath: 'artifacts/index.html',
    });
    const events = await readDesignJuryPanelEvents(project.id, run.id);

    expect(calls.filter((call) => call.endsWith(':designer'))).toEqual([
      'primary:designer',
      'degraded:designer',
    ]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'parser_warning',
          warning: 'degraded:timeout',
        }),
        expect.objectContaining({
          type: 'panelist_dim',
          role: 'designer',
          rating: 3,
        }),
      ]),
    );
  });

  it('rejects obvious prose before AI-emitted HTML artifact writes', async () => {
    const { validateHtmlArtifact } =
      await import('@/shared/services/design-mode/artifact-validate');

    expect(validateHtmlArtifact('')).toEqual({
      ok: false,
      reason: 'empty-html-artifact',
    });
    expect(validateHtmlArtifact('Updated the hero and button copy.')).toEqual({
      ok: false,
      reason: 'html-artifact-too-short',
    });
    expect(
      validateHtmlArtifact(
        '<!doctype html><html><head><title>Ok</title></head><body><main>Complete enough artifact.</main></body></html>',
      ),
    ).toEqual({ ok: true });
    expect(
      validateHtmlArtifact(
        '<!doctype html><html><body><main>See artifacts/index.html for the complete design.</main></body></html>',
      ),
    ).toEqual({
      ok: false,
      reason: 'html-artifact-placeholder-stub',
    });
    expect(
      validateHtmlArtifact(
        '<!doctype html><html><head><link rel="stylesheet" href="../.neuma/tokens.css"></head><body><main>Complete enough artifact.</main></body></html>',
      ),
    ).toEqual({
      ok: false,
      reason: 'html-artifact-reserved-project-path',
      reference: '../.neuma/tokens.css',
    });
    expect(
      validateHtmlArtifact(
        '<!doctype html><html><head><style>.x{background:url("../live-artifacts/data.json")}</style></head><body><main>Complete enough artifact.</main></body></html>',
      ),
    ).toEqual({
      ok: false,
      reason: 'html-artifact-reserved-project-path',
      reference: '../live-artifacts/data.json',
    });
  });

  it('bounds critique artifact writes and falls back unknown media safely', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const {
      CRITIQUE_ARTIFACT_WRITER_INTERNALS,
      CritiqueArtifactTooLargeError,
      writeCritiqueArtifact,
    } = await import('@/shared/services/design-mode/critique/artifact-writer');
    const project = await createDesignProject({
      title: 'Artifact writer',
      surface: 'prototype',
    });

    const ref = await writeCritiqueArtifact(project.id, 'jury_unknown123', {
      body: 'binary-ish data',
      mediaType: 'application/x-custom',
    });

    expect(ref).toMatchObject({
      mediaType: 'application/octet-stream',
      byteLength: Buffer.byteLength('binary-ish data'),
    });
    await expect(
      fs.readFile(
        resolveProjectPath(project.id, 'critique/jury_unknown123/artifact.bin')
          .absolutePath,
        'utf-8',
      ),
    ).resolves.toBe('binary-ish data');

    await expect(
      writeCritiqueArtifact(project.id, 'jury_big123', {
        body: Buffer.alloc(
          CRITIQUE_ARTIFACT_WRITER_INTERNALS.TEXT_ARTIFACT_MAX_BYTES + 1,
        ),
        mediaType: 'text/plain',
      }),
    ).rejects.toBeInstanceOf(CritiqueArtifactTooLargeError);
    await expect(
      fs.stat(
        resolveProjectPath(project.id, 'critique/jury_big123/artifact.txt')
          .absolutePath,
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('interrupts a live project-keyed run idempotently', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeJsonAtomic } =
      await import('@/shared/services/design-mode/fs');
    const { interruptDesignJuryRun } =
      await import('@/shared/services/design-mode/critique/design-jury');
    const { registerDesignJuryRun } =
      await import('@/shared/services/design-mode/critique/run-registry');
    const project = await createDesignProject({
      title: 'Interrupt live run',
      surface: 'prototype',
    });
    const runId = 'jury_live1234';
    const controller = new AbortController();
    registerDesignJuryRun(project.id, runId, controller);
    await writeJsonAtomic(
      resolveProjectPath(project.id, `critique/${runId}/transcript.json`)
        .absolutePath,
      {
        schema: 'design-jury.v1',
        run: {
          id: runId,
          projectId: project.id,
          artifactPath: 'artifacts/index.html',
          status: 'running',
          protocolVersion: 'design-jury.v1',
          createdAt: new Date().toISOString(),
          overallScore: 0,
          roles: [],
          mustFix: [],
          quickWins: [],
          transcriptPath: `critique/${runId}/transcript.json`,
          summaryPath: `critique/${runId}/summary.md`,
        },
      },
    );

    const first = await interruptDesignJuryRun(project.id, runId);
    const second = await interruptDesignJuryRun(project.id, runId);

    expect(controller.signal.aborted).toBe(true);
    expect(first).toMatchObject({
      accepted: true,
      prevStatus: 'running',
      run: { status: 'interrupted' },
    });
    expect(second).toMatchObject({
      accepted: true,
      prevStatus: 'interrupted',
      run: { status: 'interrupted' },
    });
  });

  it('recovers a stale running run when no live handle exists', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeJsonAtomic } =
      await import('@/shared/services/design-mode/fs');
    const { interruptDesignJuryRun } =
      await import('@/shared/services/design-mode/critique/design-jury');
    const project = await createDesignProject({
      title: 'Recover stale run',
      surface: 'prototype',
    });
    const runId = 'jury_stale1234';
    await writeJsonAtomic(
      resolveProjectPath(project.id, `critique/${runId}/transcript.json`)
        .absolutePath,
      {
        schema: 'design-jury.v1',
        run: {
          id: runId,
          projectId: project.id,
          artifactPath: 'artifacts/index.html',
          status: 'running',
          protocolVersion: 'design-jury.v1',
          createdAt: new Date().toISOString(),
          overallScore: 0,
          roles: [],
          mustFix: [],
          quickWins: [],
          transcriptPath: `critique/${runId}/transcript.json`,
          summaryPath: `critique/${runId}/summary.md`,
        },
      },
    );

    await expect(
      interruptDesignJuryRun(project.id, runId),
    ).resolves.toMatchObject({
      accepted: true,
      prevStatus: 'running',
      recovered: true,
      run: {
        status: 'interrupted',
        recoveryReason: 'no_live_handle',
      },
    });
  });
});

function transcriptFromContext(
  context: CritiquePanelistAdapterContext,
  parserWarnings: string[],
  score = context.roleScore.score,
) {
  return {
    role: context.role,
    round: context.round,
    score,
    passes: context.roleScore.mustFix.length === 0,
    evidence: context.roleScore.evidence,
    mustFix: context.roleScore.mustFix,
    quickWins: context.roleScore.quickWins,
    parserWarnings,
  };
}
