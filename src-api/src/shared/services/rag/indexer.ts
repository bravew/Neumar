/**
 * Workspace RAG Indexer
 *
 * Walks the user's workspace, chunks source files, embeds the chunks, and
 * upserts them into `workspace_chunks` (+ FTS5 trigger) and `vec_workspace`
 * (sqlite-vec). Re-runs are content-hash idempotent — unchanged files are
 * skipped, deleted files are pruned.
 *
 * v1 chunking: 400-line sliding window with 80-line overlap. Tree-sitter
 * symbol-aware chunking is a v2 follow-up — gives meaningfully better
 * recall but adds a binary dep. The current shape ports cleanly to it.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

import { getDatabase } from '@/shared/db';
import { getSetting } from '@/shared/db/operations';
import {
  embed,
  getEmbedOptions,
  getMemoryConfig,
} from '@/shared/services/memory';
import { sha1 } from '@/shared/utils/hash';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('RagIndexer');

const DEFAULT_CHUNK_LINES = 80;
const DEFAULT_OVERLAP_LINES = 16;
const MAX_FILE_BYTES = 1_500_000; // 1.5 MB safety cap
const MAX_CONTENT_BYTES = 8_000; // per-chunk truncation

const CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.mdx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.scala',
  '.sh',
  '.bash',
  '.zsh',
  '.toml',
  '.yaml',
  '.yml',
  '.sql',
  '.html',
  '.css',
  '.scss',
]);

const ALWAYS_IGNORE = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'target',
  '.turbo',
  '.cache',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.idea',
  '.vscode',
  '.neuma',
  '.neumar',
  'graphify-out',
  'coverage',
  '.next-prod',
  'out',
]);

export interface IndexStats {
  scanned: number;
  indexed: number;
  skipped: number;
  pruned: number;
  errored: number;
  durationMs: number;
}

export interface IndexOptions {
  /** Workspace root override; defaults to getSetting('workDir'). */
  root?: string;
  /** Hard cap on number of files processed per call. */
  maxFiles?: number;
  /** When true, files removed from disk are pruned from the index. */
  prune?: boolean;
  /** When true, skip embedding (FTS-only index — useful for tests / progress). */
  skipEmbedding?: boolean;
  /** Lines per chunk (default 80). */
  chunkLines?: number;
  /** Overlap between chunks (default 16). */
  overlapLines?: number;
  /** Optional explicit list of paths to (re)index. Skips the walk. */
  paths?: string[];
}

interface ChunkRecord {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  symbol: string | null;
  language: string;
  content: string;
  contentHash: string;
}

function languageFromExt(ext: string): string {
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.rs':
      return 'rust';
    case '.md':
    case '.mdx':
      return 'markdown';
    case '.json':
      return 'json';
    case '.go':
      return 'go';
    case '.sql':
      return 'sql';
    default:
      return ext.replace(/^\./, '') || 'text';
  }
}

async function loadGitignore(
  root: string,
): Promise<((p: string) => boolean) | null> {
  const file = join(root, '.gitignore');
  if (!existsSync(file)) return null;
  try {
    const text = await readFile(file, 'utf8');
    const patterns = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/^\//, '').replace(/\/$/, ''));
    if (patterns.length === 0) return null;
    return (rel: string) => {
      const segments = rel.split('/').filter(Boolean);
      return patterns.some(
        (p) =>
          segments.includes(p) ||
          rel === p ||
          rel.startsWith(`${p}/`) ||
          rel.endsWith(`/${p}`),
      );
    };
  } catch {
    return null;
  }
}

async function* walk(
  root: string,
  ignore: ((p: string) => boolean) | null,
): AsyncGenerator<string> {
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (ALWAYS_IGNORE.has(entry.name)) continue;
      const rel = relative(root, full);
      if (ignore && ignore(rel)) continue;
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        if (!CODE_EXTENSIONS.has(extname(entry.name))) continue;
        yield full;
      }
    }
  }
}

function chunkLines(
  text: string,
  chunkSize: number,
  overlap: number,
): { start: number; end: number; content: string }[] {
  const lines = text.split(/\r?\n/);
  if (lines.length <= chunkSize) {
    return [{ start: 1, end: lines.length, content: text }];
  }
  const stride = Math.max(1, chunkSize - overlap);
  const out: { start: number; end: number; content: string }[] = [];
  for (let i = 0; i < lines.length; i += stride) {
    const slice = lines.slice(i, i + chunkSize);
    if (slice.length === 0) break;
    out.push({
      start: i + 1,
      end: Math.min(i + slice.length, lines.length),
      content: slice.join('\n'),
    });
    if (i + chunkSize >= lines.length) break;
  }
  return out;
}

/** Best-effort symbol extraction from the chunk's first non-blank line. */
function detectSymbol(content: string, language: string): string | null {
  const first = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  if (!first) return null;
  if (language === 'typescript' || language === 'javascript') {
    const m =
      /(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(
        first,
      );
    return m?.[1] ?? null;
  }
  if (language === 'python') {
    const m = /^\s*(?:def|class)\s+([A-Za-z_][\w]*)/.exec(first);
    return m?.[1] ?? null;
  }
  if (language === 'rust') {
    const m =
      /^\s*(?:pub\s+)?(?:fn|struct|enum|trait|mod)\s+([A-Za-z_][\w]*)/.exec(
        first,
      );
    return m?.[1] ?? null;
  }
  return null;
}

function chunkIdFor(path: string, startLine: number): string {
  return sha1(`${path}:${startLine}`);
}

interface ExistingRow {
  id: string;
  content_hash: string;
}

async function indexFile(
  root: string,
  filePath: string,
  options: Required<
    Pick<IndexOptions, 'chunkLines' | 'overlapLines' | 'skipEmbedding'>
  >,
): Promise<{ indexed: number; skipped: number; errored: number }> {
  const db = getDatabase();
  const rel = relative(root, filePath);

  let st;
  try {
    st = await stat(filePath);
  } catch {
    return { indexed: 0, skipped: 0, errored: 1 };
  }
  if (st.size > MAX_FILE_BYTES) return { indexed: 0, skipped: 1, errored: 0 };

  const text = await readFile(filePath, 'utf8').catch(() => null);
  if (text == null) return { indexed: 0, skipped: 0, errored: 1 };

  const ext = extname(filePath);
  const language = languageFromExt(ext);
  const chunks = chunkLines(text, options.chunkLines, options.overlapLines);
  const records: ChunkRecord[] = chunks.map((c) => {
    const truncated =
      c.content.length > MAX_CONTENT_BYTES
        ? c.content.slice(0, MAX_CONTENT_BYTES)
        : c.content;
    return {
      id: chunkIdFor(rel, c.start),
      path: rel,
      startLine: c.start,
      endLine: c.end,
      symbol: detectSymbol(truncated, language),
      language,
      content: truncated,
      contentHash: sha1(truncated),
    };
  });

  // Existing rows for this path — diff by content_hash to skip work.
  const existingRows = db
    .prepare(`SELECT id, content_hash FROM workspace_chunks WHERE path = ?`)
    .all(rel) as ExistingRow[];
  const existingById = new Map(existingRows.map((r) => [r.id, r.content_hash]));
  const newIds = new Set(records.map((r) => r.id));

  const upsert = db.prepare(`
    INSERT INTO workspace_chunks
      (id, path, start_line, end_line, symbol, language, content, content_hash, mtime, indexed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      path = excluded.path,
      start_line = excluded.start_line,
      end_line = excluded.end_line,
      symbol = excluded.symbol,
      language = excluded.language,
      content = excluded.content,
      content_hash = excluded.content_hash,
      mtime = excluded.mtime,
      indexed_at = excluded.indexed_at
  `);
  const removeOld = db.prepare(`DELETE FROM workspace_chunks WHERE id = ?`);
  const removeVec = db.prepare(`DELETE FROM vec_workspace WHERE chunk_id = ?`);

  const now = Date.now();
  const mtime = Math.floor(st.mtimeMs);
  const toEmbed: ChunkRecord[] = [];

  const tx = db.transaction(() => {
    for (const record of records) {
      const existing = existingById.get(record.id);
      if (existing === record.contentHash) continue;
      upsert.run(
        record.id,
        record.path,
        record.startLine,
        record.endLine,
        record.symbol,
        record.language,
        record.content,
        record.contentHash,
        mtime,
        now,
      );
      toEmbed.push(record);
    }
    // Prune chunks that disappeared (file shrunk or shifted).
    for (const row of existingRows) {
      if (!newIds.has(row.id)) {
        removeOld.run(row.id);
        try {
          removeVec.run(row.id);
        } catch {
          // vec_workspace may be unavailable
        }
      }
    }
  });
  tx();

  if (options.skipEmbedding || toEmbed.length === 0) {
    return {
      indexed: toEmbed.length,
      skipped: records.length - toEmbed.length,
      errored: 0,
    };
  }

  // Embed sequentially to avoid overwhelming the local ONNX session.
  const config = getMemoryConfig();
  const embedOptions = getEmbedOptions(config);
  const insertVec = db.prepare(
    `INSERT INTO vec_workspace (chunk_id, embedding) VALUES (?, ?)`,
  );

  let errored = 0;
  for (const record of toEmbed) {
    try {
      const vec = await embed(record.content, embedOptions);
      try {
        removeVec.run(record.id);
      } catch {
        // ignore — vec_workspace may not exist when sqlite-vec is missing
      }
      try {
        insertVec.run(record.id, Buffer.from(vec.buffer));
      } catch (err) {
        // sqlite-vec missing — silently skip vector store; FTS still works.
        logger.debug(`vec_workspace insert failed for ${record.id}: ${err}`);
      }
    } catch (err) {
      errored++;
      logger.warn(`Embedding failed for ${rel}:${record.startLine}: ${err}`);
    }
  }

  return {
    indexed: toEmbed.length,
    skipped: records.length - toEmbed.length,
    errored,
  };
}

/** Remove all chunks for paths that no longer exist on disk. */
function pruneMissing(root: string): number {
  const db = getDatabase();
  const rows = db
    .prepare(`SELECT DISTINCT path FROM workspace_chunks`)
    .all() as { path: string }[];
  let pruned = 0;
  const removeByPath = db.prepare(
    `DELETE FROM workspace_chunks WHERE path = ?`,
  );
  for (const row of rows) {
    if (!existsSync(resolve(root, row.path))) {
      const result = removeByPath.run(row.path);
      pruned += result.changes;
    }
  }
  return pruned;
}

export async function indexWorkspace(
  options: IndexOptions = {},
): Promise<IndexStats> {
  const start = Date.now();
  const configured = options.root ?? getSetting('workDir');
  if (!configured) throw new Error('workDir not configured');
  const root = resolve(configured);
  if (!existsSync(root)) {
    throw new Error(`Workspace root does not exist: ${root}`);
  }

  const ignore = await loadGitignore(root);
  const limits = {
    chunkLines: options.chunkLines ?? DEFAULT_CHUNK_LINES,
    overlapLines: options.overlapLines ?? DEFAULT_OVERLAP_LINES,
    skipEmbedding: options.skipEmbedding ?? false,
  };

  const stats: IndexStats = {
    scanned: 0,
    indexed: 0,
    skipped: 0,
    pruned: 0,
    errored: 0,
    durationMs: 0,
  };

  const files: string[] = [];
  if (options.paths && options.paths.length > 0) {
    for (const p of options.paths) {
      const abs = resolve(root, p);
      if (existsSync(abs)) files.push(abs);
    }
  } else {
    for await (const file of walk(root, ignore)) {
      files.push(file);
      if (options.maxFiles && files.length >= options.maxFiles) break;
    }
  }

  for (const file of files) {
    stats.scanned++;
    try {
      const result = await indexFile(root, file, limits);
      stats.indexed += result.indexed;
      stats.skipped += result.skipped;
      stats.errored += result.errored;
    } catch (err) {
      stats.errored++;
      logger.warn(`indexFile failed for ${file}: ${err}`);
    }
  }

  if (options.prune) {
    stats.pruned = pruneMissing(root);
  }

  // Persist last-run metadata.
  try {
    const db = getDatabase();
    const upsert = db.prepare(
      `INSERT INTO workspace_index_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    );
    upsert.run('last_run_at', new Date().toISOString());
    upsert.run('last_root', root);
    upsert.run('last_stats', JSON.stringify(stats));
  } catch (err) {
    logger.debug(`Failed to persist index meta: ${err}`);
  }

  stats.durationMs = Date.now() - start;
  logger.info(
    `Workspace indexed: scanned=${stats.scanned} indexed=${stats.indexed} skipped=${stats.skipped} pruned=${stats.pruned} errored=${stats.errored} (${stats.durationMs}ms)`,
  );
  return stats;
}

export interface IndexSummary {
  totalChunks: number;
  totalFiles: number;
  lastRunAt: string | null;
  lastRoot: string | null;
  lastStats: IndexStats | null;
}

export function getIndexSummary(): IndexSummary {
  const db = getDatabase();
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c, COUNT(DISTINCT path) AS f FROM workspace_chunks`,
    )
    .get() as { c: number; f: number };
  const meta = db
    .prepare(`SELECT key, value FROM workspace_index_meta`)
    .all() as { key: string; value: string }[];
  const map = new Map(meta.map((row) => [row.key, row.value]));
  let lastStats: IndexStats | null = null;
  const raw = map.get('last_stats');
  if (raw) {
    try {
      lastStats = JSON.parse(raw) as IndexStats;
    } catch {
      lastStats = null;
    }
  }
  return {
    totalChunks: total.c,
    totalFiles: total.f,
    lastRunAt: map.get('last_run_at') ?? null,
    lastRoot: map.get('last_root') ?? null,
    lastStats,
  };
}

export function clearWorkspaceIndex(): { chunks: number } {
  const db = getDatabase();
  const result = db.prepare(`DELETE FROM workspace_chunks`).run();
  try {
    db.prepare(`DELETE FROM vec_workspace`).run();
  } catch {
    // vec_workspace may not exist
  }
  return { chunks: result.changes };
}
