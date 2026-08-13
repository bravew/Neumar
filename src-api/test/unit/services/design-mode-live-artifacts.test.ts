import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode live artifacts service', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-live-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-live-work-'));
    vi.stubEnv('HOME', tempHome);
    const { saveSetting } = await import('@/shared/db/operations');
    saveSetting('workDir', workDir);
  });

  afterEach(async () => {
    const { closeDatabase } = await import('@/shared/db');
    closeDatabase();
    vi.unstubAllEnvs();
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('creates and refreshes a project-native artifact from project JSON', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const {
      createDesignLiveArtifact,
      getDesignLiveArtifactDetail,
      refreshDesignLiveArtifact,
    } = await import('@/shared/services/design-mode/live-artifacts');
    const project = await createDesignProject({
      title: 'Service live report',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/data.json',
      JSON.stringify({ total: 1 }),
    );

    const artifact = await createDesignLiveArtifact(project.id, {
      title: 'Totals',
      source: { kind: 'project-file', path: 'artifacts/data.json' },
      templateHtml: '<main>{{DATA_JSON}}</main>',
    });

    expect(artifact.status).toBe('ready');
    await expect(
      fs.readFile(
        resolveProjectPath(project.id, artifact.entrypointPath).absolutePath,
        'utf-8',
      ),
    ).resolves.toContain('"total": 1');

    await writeProjectTextFile(
      project.id,
      'artifacts/data.json',
      JSON.stringify({ total: 2 }),
    );
    const refreshed = await refreshDesignLiveArtifact(project.id, artifact.id);
    expect(refreshed.status).toBe('ready');
    const detail = await getDesignLiveArtifactDetail(project.id, artifact.id);
    expect(detail.provenance).toEqual(
      expect.objectContaining({
        connectorId: 'project-json',
        outputPath: artifact.entrypointPath,
      }),
    );
    expect(detail.refreshLog.length).toBeGreaterThanOrEqual(2);
    await expect(
      fs.readFile(
        resolveProjectPath(project.id, artifact.entrypointPath).absolutePath,
        'utf-8',
      ),
    ).resolves.toContain('"total": 2');
  });

  it('does not overwrite the prior preview when refresh data is invalid', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { createDesignLiveArtifact, refreshDesignLiveArtifact } =
      await import('@/shared/services/design-mode/live-artifacts');
    const project = await createDesignProject({
      title: 'Failed refresh',
      surface: 'prototype',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/data.json',
      JSON.stringify({ state: 'stable' }),
    );
    const artifact = await createDesignLiveArtifact(project.id, {
      source: { kind: 'project-file', path: 'artifacts/data.json' },
      templateHtml: '<main>{{DATA_JSON}}</main>',
    });
    const entrypoint = resolveProjectPath(
      project.id,
      artifact.entrypointPath,
    ).absolutePath;
    const before = await fs.readFile(entrypoint, 'utf-8');

    await writeProjectTextFile(project.id, 'artifacts/data.json', '{invalid');
    const failed = await refreshDesignLiveArtifact(project.id, artifact.id);

    expect(failed.status).toBe('failed');
    expect(failed.lastError).toMatch(/JSON/);
    await expect(fs.readFile(entrypoint, 'utf-8')).resolves.toBe(before);
  });

  it('reconciles orphaned live-artifact folders with synthesized manifests', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { listDesignLiveArtifacts, reconcileAllDesignLiveArtifactManifests } =
      await import('@/shared/services/design-mode/live-artifacts');

    const project = await createDesignProject({
      title: 'Orphan live artifact',
      surface: 'prototype',
    });
    await createDesignProject({
      title: 'Clean project',
      surface: 'prototype',
    });
    const artifactRoot = resolveProjectPath(
      project.id,
      'live-artifacts/live_recovered01',
    ).absolutePath;
    await fs.mkdir(artifactRoot, { recursive: true });
    await fs.writeFile(
      path.join(artifactRoot, 'index.html'),
      '<main>Recovered</main>',
      'utf-8',
    );

    await expect(listDesignLiveArtifacts(project.id)).resolves.toEqual([]);

    await expect(reconcileAllDesignLiveArtifactManifests()).resolves.toEqual({
      projects: 1,
      artifacts: 1,
    });

    const artifacts = await listDesignLiveArtifacts(project.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toEqual(
      expect.objectContaining({
        id: 'live_recovered01',
        kind: 'html',
        synthesized: true,
        entrypointPath: 'live-artifacts/live_recovered01/index.html',
      }),
    );
    await expect(
      fs.readFile(path.join(artifactRoot, 'artifact.json'), 'utf-8'),
    ).resolves.toContain('"synthesized": true');
    await expect(
      fs.readFile(path.join(artifactRoot, 'template.html'), 'utf-8'),
    ).resolves.toContain('Recovered');
  });

  it('does not reconcile scaffold-only live-artifact folders', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath } =
      await import('@/shared/services/design-mode/fs');
    const { listDesignLiveArtifacts, reconcileAllDesignLiveArtifactManifests } =
      await import('@/shared/services/design-mode/live-artifacts');

    const project = await createDesignProject({
      title: 'Scaffold only',
      surface: 'prototype',
    });
    const artifactRoot = resolveProjectPath(
      project.id,
      'live-artifacts/live_scaffold01',
    ).absolutePath;
    await fs.mkdir(artifactRoot, { recursive: true });
    await fs.writeFile(
      path.join(artifactRoot, 'template.html'),
      '<main>Scaffold</main>',
      'utf-8',
    );
    await fs.writeFile(path.join(artifactRoot, 'data.json'), '{}', 'utf-8');

    await expect(reconcileAllDesignLiveArtifactManifests()).resolves.toEqual({
      projects: 0,
      artifacts: 0,
    });
    await expect(listDesignLiveArtifacts(project.id)).resolves.toEqual([]);
  });
});
