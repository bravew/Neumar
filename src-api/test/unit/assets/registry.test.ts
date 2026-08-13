import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAssetRegistry } from '@/shared/assets';
import { migration as migration001 } from '@/shared/db/migrations/001_init';
import { migration as migration034 } from '@/shared/db/migrations/034_assets_catalog';
import { runMigrations } from '@/shared/db/migrations/runner';

import { createTestDb } from '../../helpers/db';

let workspaceRoot: string;

describe('AssetRegistry', () => {
  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'assets-registry-'),
    );
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('ingests local files idempotently and maintains tags and attachments', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      await fs.writeFile(
        path.join(workspaceRoot, 'sunset-note.txt'),
        'orange sunset over lake',
      );
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });

      const first = await registry.ingest({
        source: 'local_fs',
        storagePath: 'sunset-note.txt',
        clientRequestId: 'req-asset-1',
        hint: {
          title: 'Lake sunset',
          description: 'Warm orange light over water',
          tags: ['Travel', 'sunset'],
        },
      });
      const duplicate = await registry.ingest({
        source: 'local_fs',
        storagePath: 'sunset-note.txt',
        clientRequestId: 'req-asset-1',
      });

      expect(first.created).toBe(true);
      expect(duplicate.created).toBe(false);
      expect(duplicate.asset.id).toBe(first.asset.id);
      expect(first.asset.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(first.asset.tags).toEqual(['sunset', 'travel']);

      registry.attach(
        first.asset.id,
        { scope: 'video_project', scopeId: 'project-1' },
        'b-roll',
      );

      const listed = registry.list({ tags: ['sunset'] });
      expect(listed.items.map((asset) => asset.id)).toEqual([first.asset.id]);
      expect(registry.get(first.asset.id)?.attachments).toEqual([
        {
          scope: 'video_project',
          scopeId: 'project-1',
          role: 'b-roll',
          attachedAt: expect.any(Number),
        },
      ]);

      const jobs = db
        .prepare('SELECT kind, status FROM asset_jobs')
        .all() as Array<{ kind: string; status: string }>;
      expect(jobs).toEqual([{ kind: 'ingest', status: 'queued' }]);

      registry.softDelete(first.asset.id);
      expect(registry.get(first.asset.id)).toBeNull();
      expect(registry.list({ tags: ['sunset'] }).items).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('rejects symlink escapes from the workspace', async () => {
    const { db, cleanup } = createTestDb();
    const outsideRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'assets-outside-'),
    );
    try {
      runMigrations(db, [migration001, migration034]);
      await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'outside');
      await fs.symlink(
        path.join(outsideRoot, 'secret.txt'),
        path.join(workspaceRoot, 'linked-secret.txt'),
      );
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });

      await expect(
        registry.ingest({
          source: 'local_fs',
          storagePath: 'linked-secret.txt',
        }),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      cleanup();
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('restores soft-deleted idempotency matches instead of violating unique constraints', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      await fs.writeFile(path.join(workspaceRoot, 'restore-me.txt'), 'restore');
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });

      const original = await registry.ingest({
        source: 'local_fs',
        storagePath: 'restore-me.txt',
        clientRequestId: 'restore-request',
        hint: { tags: ['Original'] },
      });
      registry.softDelete(original.asset.id);

      const restored = await registry.ingest({
        source: 'local_fs',
        storagePath: 'restore-me.txt',
        clientRequestId: 'restore-request',
        hint: { tags: ['Restored'] },
      });

      expect(restored.created).toBe(false);
      expect(restored.asset.id).toBe(original.asset.id);
      expect(restored.asset.deletedAt).toBeNull();
      expect(restored.asset.tags).toEqual(['restored']);
      expect(restored.asset.indexState).toBe('pending');
      expect(
        db
          .prepare('SELECT kind, status FROM asset_jobs ORDER BY created_at')
          .all(),
      ).toEqual([
        { kind: 'ingest', status: 'queued' },
        { kind: 'ingest', status: 'queued' },
      ]);
    } finally {
      cleanup();
    }
  });

  it('classifies local PDFs without requiring a MIME hint', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      await fs.writeFile(
        path.join(workspaceRoot, 'brief.pdf'),
        '%PDF-1.1\n% catalog fixture\n%%EOF\n',
      );
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });

      const result = await registry.ingest({
        source: 'local_fs',
        storagePath: 'brief.pdf',
      });

      expect(result.asset.kind).toBe('pdf');
      expect(result.asset.mime).toBe('application/pdf');
    } finally {
      cleanup();
    }
  });

  it('garbage collects old soft-deleted assets only after attachments are gone', async () => {
    const { db, cleanup } = createTestDb();
    try {
      runMigrations(db, [migration001, migration034]);
      await fs.writeFile(path.join(workspaceRoot, 'delete-me.txt'), 'delete');
      await fs.writeFile(path.join(workspaceRoot, 'keep-me.txt'), 'keep');
      const registry = createAssetRegistry({
        db,
        getWorkspaceRoot: () => workspaceRoot,
      });

      const deleted = await registry.ingest({
        source: 'local_fs',
        storagePath: 'delete-me.txt',
      });
      const attached = await registry.ingest({
        source: 'local_fs',
        storagePath: 'keep-me.txt',
      });
      registry.attach(
        attached.asset.id,
        { scope: 'video_project', scopeId: 'project-1' },
        'b-roll',
      );
      await fs.mkdir(
        path.join(workspaceRoot, '.cache', 'assets', deleted.asset.id),
        { recursive: true },
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.cache', 'assets', deleted.asset.id, 'x'),
        'thumb',
      );

      registry.softDelete(deleted.asset.id);
      registry.softDelete(attached.asset.id);

      const result = registry.garbageCollectDeleted({
        retentionMs: 0,
        now: Date.now() + 1,
      });

      expect(result).toMatchObject({
        scanned: 2,
        purged: 1,
        skippedAttached: 1,
        errors: [],
      });
      expect(result.bytesFreed).toBe(deleted.asset.bytes);
      // GC removes only asset-managed derivatives (the .cache/assets/<id>
      // directory here), never the original in-place source file.
      expect(result.filesDeleted).toBe(1);
      await expect(
        fs.access(
          path.join(workspaceRoot, '.cache', 'assets', deleted.asset.id),
        ),
      ).rejects.toThrow();
      // The user's original file must survive purging the catalog row.
      await expect(
        fs.access(path.join(workspaceRoot, 'delete-me.txt')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(workspaceRoot, 'keep-me.txt')),
      ).resolves.toBeUndefined();
      expect(
        db.prepare('SELECT id FROM assets WHERE id = ?').get(deleted.asset.id),
      ).toBeUndefined();
      expect(
        db
          .prepare('SELECT deleted_at FROM assets WHERE id = ?')
          .get(attached.asset.id),
      ).toMatchObject({ deleted_at: expect.any(Number) });
    } finally {
      cleanup();
    }
  });
});
