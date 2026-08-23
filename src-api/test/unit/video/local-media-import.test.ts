import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDatabase } from '@/shared/db';
import { setSetting } from '@/shared/db/operations';
import {
  addLinkedSource,
  attachLinkedAsset,
  listLinkedAssets,
  runLinkedSourceSyncJob,
} from '@/shared/video/linked-sources';
import { createLocalFolderGrant } from '@/shared/video/linked-sources/local-grants';
import {
  addExternalProjectAsset,
  addProjectAssetFromPath,
  createProject,
  deleteProjectAsset,
} from '@/shared/video/store';
import type { VideoJob } from '@/shared/video/types';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Local media is already on this machine. Importing it should cost at most one
// copy — ideally a copy-on-write clone — and re-importing bytes the project
// already holds should cost none at all. These tests pin that down, because the
// waste is invisible in the UI: the old code round-tripped every linked master
// through an in-memory Buffer, and wrote a full copy just to hash it and delete
// it again when it turned out to be a duplicate.
describe('local media import disk usage', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'local-import-'));
    vi.stubEnv('NEUMA_VIDEO_WORKDIR', workDir);
    setSetting('workDir', workDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(workDir, { recursive: true, force: true });
  });

  describe('attaching from a linked local folder', () => {
    async function linkFolderWithPhoto(projectName: string) {
      const project = await createProject({
        name: projectName,
        template: 'slideshow',
      });
      const mediaDir = path.join(workDir, `${projectName}-media`);
      await fs.mkdir(mediaDir, { recursive: true });
      const photoPath = path.join(mediaDir, 'photo.png');
      await fs.writeFile(photoPath, PNG_BYTES);

      const grant = await createLocalFolderGrant(mediaDir);
      const added = await addLinkedSource(project.id, {
        provider: 'local-fs',
        rootPath: grant.rootPath,
        localGrantToken: grant.token,
        filters: { types: ['image'] },
      });
      await runLinkedSourceSyncJob(jobFor(project.id, added.source.id));
      const [linked] = listLinkedAssets(project.id, {
        sourceId: added.source.id,
      });
      return { project, photoPath, linkedId: linked!.id };
    }

    it("registers the user's file as the master without copying it", async () => {
      const { project, photoPath, linkedId } =
        await linkFolderWithPhoto('inplace');
      const copyFile = vi.spyOn(fs, 'copyFile');

      const { asset } = await attachLinkedAsset(project.id, linkedId);

      expect(copyFile).not.toHaveBeenCalled();
      expect(asset.origin).toBe('external');
      // The adapter resolves symlinks (/var → /private/var on macOS).
      expect(asset.path).toBe(await fs.realpath(photoPath));
    });

    it('writes nothing when the project already holds those bytes', async () => {
      const { project, linkedId } = await linkFolderWithPhoto('dedup');
      const first = await attachLinkedAsset(project.id, linkedId);

      const copyFile = vi.spyOn(fs, 'copyFile');
      const writeFile = vi.spyOn(fs, 'writeFile');
      const second = await attachLinkedAsset(project.id, linkedId);

      expect(copyFile).not.toHaveBeenCalled();
      // project.json is still rewritten; no media bytes are.
      const mediaWrites = writeFile.mock.calls.filter(([target]) =>
        String(target).includes(`${path.sep}assets${path.sep}`),
      );
      expect(mediaWrites).toEqual([]);
      expect(second.asset.id).toBe(first.asset.id);
      expect(second.project.assets).toHaveLength(1);
    });

    it('stays readable across repeated attaches, still without copying', async () => {
      const { project, linkedId } = await linkFolderWithPhoto('single');
      await attachLinkedAsset(project.id, linkedId);
      await attachLinkedAsset(project.id, linkedId);
      const third = await attachLinkedAsset(project.id, linkedId);

      expect(third.project.assets).toHaveLength(1);
      // Nothing was ever written into the project's assets dir.
      const assetsDir = path.join(workDir, 'videos', project.id, 'assets');
      await expect(fs.readdir(assetsDir)).rejects.toThrow();
      await expect(fs.access(third.asset.path)).resolves.toBeUndefined();
    });
  });

  describe('indexing a local folder', () => {
    it('skips AppleDouble and OS metadata files that look like media', async () => {
      const project = await createProject({
        name: 'Noise',
        template: 'slideshow',
      });
      const mediaDir = path.join(workDir, 'noise-media');
      await fs.mkdir(mediaDir, { recursive: true });
      await fs.writeFile(path.join(mediaDir, 'photo.png'), PNG_BYTES);
      // What a card formatted exFAT leaves next to every real file.
      await fs.writeFile(path.join(mediaDir, '._photo.png'), PNG_BYTES);
      await fs.writeFile(path.join(mediaDir, '.DS_Store'), PNG_BYTES);
      await fs.writeFile(path.join(mediaDir, 'Thumbs.db'), PNG_BYTES);

      const grant = await createLocalFolderGrant(mediaDir);
      const added = await addLinkedSource(project.id, {
        provider: 'local-fs',
        rootPath: grant.rootPath,
        localGrantToken: grant.token,
        filters: { types: ['image'] },
      });
      const result = await runLinkedSourceSyncJob(
        jobFor(project.id, added.source.id),
      );

      expect(result.fileCount).toBe(1);
      const names = listLinkedAssets(project.id, {
        sourceId: added.source.id,
      }).map((asset) => asset.name);
      expect(names).toEqual(['photo.png']);
    });

    it('sweeps out noise an earlier sync already indexed', async () => {
      const project = await createProject({
        name: 'Sweep',
        template: 'slideshow',
      });
      const mediaDir = path.join(workDir, 'sweep-media');
      await fs.mkdir(mediaDir, { recursive: true });
      await fs.writeFile(path.join(mediaDir, 'photo.png'), PNG_BYTES);

      const grant = await createLocalFolderGrant(mediaDir);
      const added = await addLinkedSource(project.id, {
        provider: 'local-fs',
        rootPath: grant.rootPath,
        localGrantToken: grant.token,
        filters: { types: ['image'] },
      });
      await runLinkedSourceSyncJob(jobFor(project.id, added.source.id));

      // Stand in for a row indexed before the crawler skipped these.
      getDatabase()
        .prepare(
          `INSERT INTO linked_assets
             (id, project_id, source_id, external_id, name, kind, indexed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'legacy-noise',
          project.id,
          added.source.id,
          path.join(mediaDir, '._photo.png'),
          '._photo.png',
          'image',
          new Date().toISOString(),
        );
      expect(
        listLinkedAssets(project.id, { sourceId: added.source.id }),
      ).toHaveLength(2);

      await runLinkedSourceSyncJob(jobFor(project.id, added.source.id));

      const names = listLinkedAssets(project.id, {
        sourceId: added.source.id,
      }).map((asset) => asset.name);
      expect(names).toEqual(['photo.png']);
    });
  });

  describe('derivative placement', () => {
    it('keeps generated files inside the project, not beside the master', async () => {
      const project = await createProject({
        name: 'Derivatives',
        template: 'slideshow',
      });
      const sourcePath = path.join(workDir, 'clip-source.png');
      await fs.writeFile(sourcePath, PNG_BYTES);
      const { asset } = await addProjectAssetFromPath(project.id, sourcePath);

      const derivativeDir = path.join(
        workDir,
        'videos',
        project.id,
        'derivatives',
        asset.id,
      );
      await fs.mkdir(derivativeDir, { recursive: true });
      await fs.writeFile(path.join(derivativeDir, 'proxy.mp4'), 'proxy');

      // Nothing generated may land next to the imported file.
      const besideSource = (await fs.readdir(workDir)).filter((name) =>
        name.startsWith('.clip-source'),
      );
      expect(besideSource).toEqual([]);

      await deleteProjectAsset(project.id, asset.id);

      // Deleting the asset takes everything derived from it.
      await expect(fs.access(derivativeDir)).rejects.toThrow();
    });
  });

  describe('referencing a local file in place', () => {
    it('adds the asset without copying, pointing at the original', async () => {
      const project = await createProject({
        name: 'External',
        template: 'slideshow',
      });
      const sourcePath = path.join(workDir, 'outside.png');
      await fs.writeFile(sourcePath, PNG_BYTES);

      const { asset } = await addExternalProjectAsset(project.id, sourcePath);

      expect(asset.origin).toBe('external');
      expect(asset.path).toBe(await fs.realpath(sourcePath));
      const assetsDir = path.join(workDir, 'videos', project.id, 'assets');
      await expect(fs.readdir(assetsDir)).rejects.toThrow();
    });

    it('reuses the asset when the same file is referenced twice', async () => {
      const project = await createProject({
        name: 'External dedup',
        template: 'slideshow',
      });
      const sourcePath = path.join(workDir, 'twice.png');
      await fs.writeFile(sourcePath, PNG_BYTES);

      const first = await addExternalProjectAsset(project.id, sourcePath);
      const second = await addExternalProjectAsset(project.id, sourcePath);

      expect(second.deduped).toBe(true);
      expect(second.asset.id).toBe(first.asset.id);
      expect(second.project.assets).toHaveLength(1);
    });

    it("leaves the user's file on disk when the asset is deleted", async () => {
      const project = await createProject({
        name: 'External delete',
        template: 'slideshow',
      });
      const sourcePath = path.join(workDir, 'keep-me.png');
      await fs.writeFile(sourcePath, PNG_BYTES);
      const { asset } = await addExternalProjectAsset(project.id, sourcePath);

      const next = await deleteProjectAsset(project.id, asset.id);

      expect(next.assets).toHaveLength(0);
      // Removing it from the project must never remove their media.
      await expect(fs.access(sourcePath)).resolves.toBeUndefined();
    });

    it('refuses a path outside the trusted roots', async () => {
      const project = await createProject({
        name: 'External guard',
        template: 'slideshow',
      });
      await expect(
        addExternalProjectAsset(project.id, '/etc/hosts'),
      ).rejects.toThrow(/trusted local roots|sensitive|not found/i);
    });
  });

  describe('attaching a local file by path', () => {
    it('skips the copy when the bytes are already attached', async () => {
      const project = await createProject({
        name: 'Path attach',
        template: 'slideshow',
      });
      const sourcePath = path.join(workDir, 'photo.png');
      await fs.writeFile(sourcePath, PNG_BYTES);

      const first = await addProjectAssetFromPath(project.id, sourcePath);

      const copyFile = vi.spyOn(fs, 'copyFile');
      const second = await addProjectAssetFromPath(project.id, sourcePath);

      expect(copyFile).not.toHaveBeenCalled();
      expect(second.asset.id).toBe(first.asset.id);
      expect(second.project.assets).toHaveLength(1);
    });

    it('still imports a distinct file', async () => {
      const project = await createProject({
        name: 'Path attach distinct',
        template: 'slideshow',
      });
      const first = path.join(workDir, 'a.png');
      const second = path.join(workDir, 'b.png');
      await fs.writeFile(first, PNG_BYTES);
      await fs.writeFile(second, Buffer.concat([PNG_BYTES, Buffer.from('b')]));

      await addProjectAssetFromPath(project.id, first);
      const result = await addProjectAssetFromPath(project.id, second);

      expect(result.project.assets).toHaveLength(2);
    });
  });
});

function jobFor(projectId: string, sourceId: string): VideoJob {
  return {
    id: `job-${sourceId}`,
    projectId,
    kind: 'linked-source.sync',
    status: 'queued',
    caller: 'in-app',
    payload: { sourceId },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as VideoJob;
}
