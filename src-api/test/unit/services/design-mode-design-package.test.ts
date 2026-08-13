import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('DesignMode design package', () => {
  let tempHome = '';
  let workDir = '';

  beforeEach(async () => {
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-pkg-home-'));
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'neuma-pkg-work-'));
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

  it('creates a .designpkg zip with manifest and source files', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { appendProjectHistory, resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { packDesignPackage } =
      await import('@/shared/services/design-mode/design-package/pack');
    const project = await createDesignProject({
      title: 'Portable project',
      surface: 'prototype',
      intent: 'landing-page',
      brief: { handoffNotes: 'Ready for engineering.' },
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main>Portable</main>',
    );
    await writeProjectTextFile(
      project.id,
      'DESIGN.md',
      '# DESIGN.md\n\n## Provenance\n\n```json\n{\"generatedAt\":\"2026-05-10T00:00:00.000Z\"}\n```\n',
    );

    const result = await packDesignPackage(project.id);
    const zipPath = resolveProjectPath(project.id, result.path).absolutePath;
    const zip = await JSZip.loadAsync(await fs.readFile(zipPath));
    const manifest = JSON.parse(
      await zip.file('DESIGN-MANIFEST.json')!.async('string'),
    ) as {
      schemaVersion: number;
      project: { intent: string; platforms: Array<{ entryFile: string }> };
      responsive: {
        breakpoints: Array<{ id: string; width: number }>;
        entryFiles: Array<{ breakpointId: string; file: string }>;
      };
      handoff: { notes: string };
      files: Array<{ path: string; byteLength: number; mediaType: string }>;
    };
    const legacyManifest = JSON.parse(
      await zip.file('manifest.json')!.async('string'),
    );

    expect(result.path).toMatch(/\.designpkg$/);
    expect(result.sha256).toHaveLength(64);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.project.intent).toBe('landing-page');
    expect(manifest.project.platforms[0]).toMatchObject({
      entryFile: 'source/artifacts/index.html',
    });
    expect(manifest.responsive.breakpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'mobile', width: 390 }),
        expect.objectContaining({ id: 'tablet', width: 768 }),
        expect.objectContaining({ id: 'desktop', width: 1280 }),
      ]),
    );
    expect(manifest.responsive.entryFiles).toEqual(
      expect.arrayContaining([
        {
          breakpointId: 'desktop',
          file: 'source/artifacts/index.html',
        },
      ]),
    );
    expect(manifest.handoff.notes).toBe('Ready for engineering.');
    expect(legacyManifest).toEqual(manifest);
    expect(zip.file('source/artifacts/index.html')).toBeTruthy();
    expect(zip.file('DESIGN.md')).toBeTruthy();
    expect(manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'source/artifacts/index.html',
          byteLength: expect.any(Number),
          mediaType: 'text/html',
        }),
      ]),
    );
    expect(manifest.files.map((file) => file.path)).toContain('DESIGN.md');
  });

  it('includes an attribution sidecar for catalog assets with credits', async () => {
    const { AssetRegistry } = await import('@/shared/assets');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { attachCatalogAssetToDesign } =
      await import('@/shared/services/design-mode/catalog-assets');
    const { packDesignPackage } =
      await import('@/shared/services/design-mode/design-package/pack');
    const project = await createDesignProject({
      title: 'Attributed project',
      surface: 'prototype',
      intent: 'landing-page',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<main>Attributed</main>',
    );
    await fs.writeFile(path.join(workDir, 'photo.png'), 'photo bytes');
    const registry = new AssetRegistry();
    const { asset } = await registry.ingest({
      source: 'local_fs',
      storagePath: 'photo.png',
      clientRequestId: 'design-pkg-photo',
      hint: {
        kind: 'image',
        mime: 'image/png',
        title: 'Photo',
        provenance: {
          licenseInfo: {
            provider: 'Pexels',
            license: 'Pexels',
            requiresAttribution: true,
            attributionText: 'Photo by Ada on Pexels',
          },
        },
      },
    });
    await attachCatalogAssetToDesign(project.id, asset.id, {
      clientRequestId: 'design-pkg-photo-attach',
    });

    const result = await packDesignPackage(project.id);
    const zipPath = resolveProjectPath(project.id, result.path).absolutePath;
    const zip = await JSZip.loadAsync(await fs.readFile(zipPath));

    await expect(
      zip.file('attribution.txt')!.async('string'),
    ).resolves.toContain('Photo by Ada on Pexels');
    expect(result.manifest.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'attribution.txt',
          mediaType: 'text/plain',
        }),
      ]),
    );
  });

  it('finalizes DESIGN.md with parseable provenance and lock conflicts', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { appendProjectHistory, resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const { finalizeDesignProject, getDesignMdState } =
      await import('@/shared/services/design-mode/finalize-design');
    const project = await createDesignProject({
      title: 'Finalizable project',
      surface: 'prototype',
      designSystemId: 'default-freeform',
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/index.html',
      '<!doctype html><html><body><main>Final artifact</main></body></html>',
    );
    const lockPath = resolveProjectPath(
      project.id,
      '.finalize.lock',
    ).absolutePath;
    await fs.writeFile(
      lockPath,
      JSON.stringify({ runId: 'finalize_existing' }),
      'utf-8',
    );

    await expect(finalizeDesignProject(project.id)).rejects.toMatchObject({
      holderRunId: 'finalize_existing',
    } satisfies { holderRunId: string });
    await fs.unlink(lockPath);

    const result = await finalizeDesignProject(project.id);
    const designMd = await fs.readFile(
      resolveProjectPath(project.id, 'DESIGN.md').absolutePath,
      'utf-8',
    );

    expect(result.path).toBe('DESIGN.md');
    expect(designMd).toContain('## Provenance');
    expect(designMd).toContain('"generator": "neuma-design-mode"');
    await expect(getDesignMdState(project.id)).resolves.toMatchObject({
      exists: true,
      isStale: false,
      currentArtifact: 'artifacts/index.html',
    });

    await appendProjectHistory(project.id, {
      type: 'project.exported',
      at: new Date().toISOString(),
    });
    await expect(getDesignMdState(project.id)).resolves.toMatchObject({
      isStale: false,
    });

    await appendProjectHistory(project.id, {
      type: 'prompt.resolved',
      at: new Date().toISOString(),
    });
    await expect(getDesignMdState(project.id)).resolves.toMatchObject({
      isStale: true,
      staleReason: 'conversation-newer',
    });
  });

  it('rejects provider key export', async () => {
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { packDesignPackage } =
      await import('@/shared/services/design-mode/design-package/pack');
    const project = await createDesignProject({
      title: 'No keys',
      surface: 'prototype',
    });

    await expect(
      packDesignPackage(project.id, { include: { providerKeys: true } }),
    ).rejects.toThrow(/provider keys/i);
  });

  it('exports a design package through the indexed export route', async () => {
    const { designRoutes } = await import('@/app/api/design');
    const { createDesignProject } =
      await import('@/shared/services/design-mode/projects');
    const { resolveProjectPath, writeProjectTextFile } =
      await import('@/shared/services/design-mode/fs');
    const project = await createDesignProject({
      title: 'Indexed package',
      surface: 'prototype',
      intent: 'app-screen',
      brief: { handoffNotes: 'Open this package in engineering.' },
    });
    await writeProjectTextFile(
      project.id,
      'artifacts/mobile.html',
      '<main>Mobile package</main>',
    );

    const response = await designRoutes.request(
      `/projects/${project.id}/export`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'designpkg' }),
      },
    );

    expect(response.status).toBe(201);
    const data = (await response.json()) as {
      export: {
        format: string;
        path: string;
        mime: string;
        size: number;
        disclosurePath: string;
      };
    };
    expect(data.export).toMatchObject({
      format: 'designpkg',
      mime: 'application/vnd.neuma.design-package+zip',
    });
    expect(data.export.path).toMatch(/\.designpkg$/);
    expect(data.export.size).toBeGreaterThan(0);

    const listed = await designRoutes.request(
      `/projects/${project.id}/exports`,
    );
    await expect(listed.json()).resolves.toMatchObject({
      exports: [expect.objectContaining({ path: data.export.path })],
    });

    const zip = await JSZip.loadAsync(
      await fs.readFile(
        resolveProjectPath(project.id, data.export.path).absolutePath,
      ),
    );
    const manifest = JSON.parse(
      await zip.file('DESIGN-MANIFEST.json')!.async('string'),
    ) as {
      project: { platforms: Array<{ entryFile: string }> };
      handoff: { notes: string };
    };
    expect(manifest.project.platforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entryFile: 'source/artifacts/mobile.html' }),
      ]),
    );
    expect(manifest.handoff.notes).toBe('Open this package in engineering.');
  });
});
