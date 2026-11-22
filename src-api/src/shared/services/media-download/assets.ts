import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { DownloadAsset, DownloadMediaOperation } from '@neumar/video-ir';

import { getDatabase } from '@/shared/db/index';
import { createFile } from '@/shared/db/operations';
import { mimeFromExtension } from '@/shared/utils/mime-extension';

/** What a saved item needs to be found again, minus any host path. */
export interface DownloadAssetRecord {
  assetId: string;
  taskId: string;
  runId: string;
  toolCallId: string;
  batchId: string;
  itemId: string;
  grantId: string;
  /** The task library file; absent on rows saved before it was recorded. */
  libraryFileId?: string;
  name: string;
  mime: string;
  size: number;
  dev: string;
  ino: string;
}

interface Row {
  asset_id: string;
  task_id: string;
  run_id: string;
  tool_call_id: string;
  batch_id: string;
  item_id: string;
  grant_id: string;
  library_file_id: string | null;
  name: string;
  mime: string;
  size: number;
  dev: string;
  ino: string;
}

function fromRow(row: Row): DownloadAssetRecord {
  return {
    assetId: row.asset_id,
    taskId: row.task_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    batchId: row.batch_id,
    itemId: row.item_id,
    grantId: row.grant_id,
    ...(row.library_file_id ? { libraryFileId: row.library_file_id } : {}),
    name: row.name,
    mime: row.mime,
    size: row.size,
    dev: row.dev,
    ino: row.ino,
  };
}

function toAsset(record: DownloadAssetRecord): DownloadAsset {
  return {
    assetId: record.assetId,
    ...(record.libraryFileId ? { libraryFileId: record.libraryFileId } : {}),
    name: record.name,
    mime: record.mime,
    size: record.size,
  };
}

/**
 * The asset a task may play, or undefined. The task id is part of the lookup,
 * so another task's asset id never resolves.
 */
export function getDownloadAsset(
  taskId: string,
  assetId: string,
): DownloadAssetRecord | undefined {
  const row = getDatabase()
    .prepare('SELECT * FROM download_assets WHERE task_id = ? AND asset_id = ?')
    .get(taskId, assetId) as Row | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * Locate the file a record names inside the granted folder, or throw.
 *
 * The record keeps a basename and an inode identity. The file must sit
 * directly in the resolved folder (a symlink or a path that resolves elsewhere
 * is refused) and must be the same file that was registered, so a replaced or
 * moved file stops playing instead of serving whatever now has that name.
 */
export async function resolveDownloadFile(
  record: Pick<DownloadAssetRecord, 'name' | 'dev' | 'ino'>,
  grantedRoot: string,
): Promise<{ path: string; size: number }> {
  const root = await fs.realpath(grantedRoot);
  const file = await fs.realpath(path.join(root, record.name));
  if (path.dirname(file) !== root) {
    throw new Error('Download file is outside its destination');
  }
  const stat = await fs.stat(file, { bigint: true });
  if (
    !stat.isFile() ||
    String(stat.dev) !== record.dev ||
    String(stat.ino) !== record.ino
  ) {
    throw new Error('Download file changed after it was saved');
  }
  return { path: file, size: Number(stat.size) };
}

/**
 * Open the file a record names for reading, checked through the open handle.
 *
 * A pathname check followed by a second open by pathname can read whatever
 * replaced the file in between. Here the file is opened once, the final
 * component may not be a symlink, and the type and identity are read from the
 * handle, so the handle the caller streams is the registered file or nothing.
 * The caller owns the handle and must close it (a read stream closes it).
 */
export async function openDownloadFile(
  record: Pick<DownloadAssetRecord, 'name' | 'dev' | 'ino'>,
  grantedRoot: string,
): Promise<{ handle: fs.FileHandle; size: number }> {
  if (path.basename(record.name) !== record.name) {
    throw new Error('Download file is outside its destination');
  }
  const root = await fs.realpath(grantedRoot);
  // O_NONBLOCK keeps a FIFO swapped in under the name from blocking the open;
  // it does not change reads of a regular file. Downloads run only on macOS
  // and Linux, where both flags exist.
  const handle = await fs.open(
    path.join(root, record.name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = await handle.stat({ bigint: true });
    if (
      !stat.isFile() ||
      String(stat.dev) !== record.dev ||
      String(stat.ino) !== record.ino
    ) {
      throw new Error('Download file changed after it was saved');
    }
    return { handle, size: Number(stat.size) };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Register one finished file, after it has been published without overwriting.
 *
 * Returns the authorized asset that the saved item carries. The asset id is its
 * own UUID: the library deduplicates by task and path, so a later download at
 * a path an earlier (since moved) download used gets the earlier library row,
 * and reusing that row's id would collide. The library file id rides along so
 * the Files panel and the download card still name one file. The library row
 * and the asset row are written in one transaction. Calling again for the same
 * item returns the same asset.
 */
export async function registerDownloadAsset(
  operation: DownloadMediaOperation,
  itemId: string,
  grantedRoot: string,
  filePath: string,
): Promise<DownloadAsset> {
  const db = getDatabase();
  const existing = db
    .prepare(
      `SELECT * FROM download_assets
       WHERE task_id = ? AND run_id = ? AND tool_call_id = ? AND batch_id = ? AND item_id = ?`,
    )
    .get(
      operation.taskId,
      operation.runId,
      operation.toolCallId,
      operation.batchId,
      itemId,
    ) as Row | undefined;
  if (existing) return toAsset(fromRow(existing));

  const name = path.basename(filePath);
  const stat = await fs.stat(await fs.realpath(filePath), { bigint: true });
  const root = await fs.realpath(grantedRoot);
  const resolved = await resolveDownloadFile(
    { name, dev: String(stat.dev), ino: String(stat.ino) },
    root,
  );
  const mime =
    mimeFromExtension(path.extname(name)) ?? 'application/octet-stream';
  // A failed asset insert rolls back a library row this call created; a row
  // that already existed for the path is left as it was.
  const record = db.transaction((): DownloadAssetRecord => {
    const file = createFile({
      task_id: operation.taskId,
      name,
      type: mime.startsWith('audio/') ? 'audio' : 'video',
      path: resolved.path,
    });
    const next: DownloadAssetRecord = {
      assetId: crypto.randomUUID(),
      taskId: operation.taskId,
      runId: operation.runId,
      toolCallId: operation.toolCallId,
      batchId: operation.batchId,
      itemId,
      grantId: operation.destinationGrantId,
      libraryFileId: String(file.id),
      name,
      mime,
      size: resolved.size,
      dev: String(stat.dev),
      ino: String(stat.ino),
    };
    db.prepare(
      `INSERT INTO download_assets
         (asset_id, task_id, run_id, tool_call_id, batch_id, item_id, grant_id,
          library_file_id, name, mime, size, dev, ino, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      next.assetId,
      next.taskId,
      next.runId,
      next.toolCallId,
      next.batchId,
      next.itemId,
      next.grantId,
      next.libraryFileId,
      next.name,
      next.mime,
      next.size,
      next.dev,
      next.ino,
      Date.now(),
    );
    return next;
  })();
  return toAsset(record);
}
