import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode project locations', () => {
  let tempHome = '';
  let workDir = '';
  let secondWorkDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-location-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-location-work-'));
    secondWorkDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'neuma-location-alt-'),
    );
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
    await fs.rm(secondWorkDir, { recursive: true, force: true });
  });

  it('adds, scans, and removes configured locations through the API', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const secondReal = await fs.realpath(secondWorkDir);

    const added = await designRoutes.request('/project-locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: secondWorkDir }),
    });

    expect(added.status).toBe(201);
    await expect(added.json()).resolves.toMatchObject({
      location: {
        path: secondReal,
        configured: true,
        isDefault: false,
        exists: true,
      },
    });

    const scan = await designRoutes.request('/project-locations/scan', {
      method: 'GET',
    });
    expect(scan.status).toBe(200);
    await expect(scan.json()).resolves.toMatchObject({
      locations: expect.arrayContaining([
        expect.objectContaining({ path: workDir, isDefault: true }),
        expect.objectContaining({ path: secondReal, configured: true }),
      ]),
      projects: [],
    });

    const removed = await designRoutes.request('/project-locations', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: secondWorkDir }),
    });
    expect(removed.status).toBe(200);
    const removedData = (await removed.json()) as {
      locations: { path: string }[];
    };
    expect(removedData.locations.map((item) => item.path)).not.toContain(
      secondReal,
    );
  });

  it('creates a project in a configured secondary location', async () => {
    const { addDesignProjectLocation, listDesignProjectLocations } =
      await import('@/shared/services/design-mode/project-locations');
    const { createDesignProject, getDesignProject, listDesignProjects } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const secondReal = await fs.realpath(secondWorkDir);
    const linkedContext = path.join(secondWorkDir, 'reference-app');
    await fs.mkdir(linkedContext);

    addDesignProjectLocation(secondWorkDir);
    const project = await createDesignProject({
      title: 'Alt workspace prototype',
      surface: 'prototype',
      workspaceRoot: secondWorkDir,
      linkedContextDirs: [linkedContext],
    });

    const projectRoot = path.join(secondReal, 'design-projects', project.id);
    await expect(
      fs.stat(path.join(projectRoot, 'project.json')),
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(workDir, 'design-projects', project.id)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(project.workspaceRoot).toBe(secondReal);
    expect(project.linkedContextDirs).toEqual([
      await fs.realpath(linkedContext),
    ]);

    await writeProjectTextFile(project.id, 'artifacts/index.html', '<main />');
    expect(
      resolveProjectPath(project.id, 'artifacts/index.html').absolutePath,
    ).toBe(path.join(projectRoot, 'artifacts/index.html'));

    await expect(getDesignProject(project.id)).resolves.toMatchObject({
      id: project.id,
      workspaceRoot: secondReal,
    });
    await expect(
      listDesignProjects().then((projects) => projects.map((item) => item.id)),
    ).resolves.toContain(project.id);
    expect(
      listDesignProjectLocations().find((item) => item.path === secondReal)
        ?.projectCount,
    ).toBe(1);
  });

  it('rejects unconfigured and unsafe project locations', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');

    await expect(
      createDesignProject({
        title: 'Outside location',
        surface: 'prototype',
        workspaceRoot: secondWorkDir,
      }),
    ).rejects.toThrow(/must be configured/);

    const createResponse = await designRoutes.request('/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Outside via API',
        surface: 'prototype',
        workspaceRoot: secondWorkDir,
      }),
    });
    expect(createResponse.status).toBe(400);

    const rootResponse = await designRoutes.request('/project-locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: path.parse(workDir).root }),
    });
    expect(rootResponse.status).toBe(400);

    const relativeResponse = await designRoutes.request('/project-locations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: 'relative/path' }),
    });
    expect(relativeResponse.status).toBe(400);
  });
});
