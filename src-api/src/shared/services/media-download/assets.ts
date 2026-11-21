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
 * Register one finished file, after it has been published without overwriting.
 *
 * Returns the authorized asset that the saved item carries. The asset ID is the
 * task's library file id, so the Files panel and the download card name one
 * file and the thread can show it once. Calling again for the same item returns
 * the same asset.
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
  const file = createFile({
    task_id: operation.taskId,
    name,
    type: mime.startsWith('audio/') ? 'audio' : 'video',
    path: resolved.path,
  });
  const record: DownloadAssetRecord = {
    assetId: String(file.id),
    taskId: operation.taskId,
    runId: operation.runId,
    toolCallId: operation.toolCallId,
    batchId: operation.batchId,
    itemId,
    grantId: operation.destinationGrantId,
    name,
    mime,
    size: resolved.size,
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
  db.prepare(
    `INSERT INTO download_assets
       (asset_id, task_id, run_id, tool_call_id, batch_id, item_id, grant_id,
        name, mime, size, dev, ino, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.assetId,
    record.taskId,
    record.runId,
    record.toolCallId,
    record.batchId,
    record.itemId,
    record.grantId,
    record.name,
    record.mime,
    record.size,
    record.dev,
    record.ino,
    Date.now(),
  );
  return toAsset(record);
}
