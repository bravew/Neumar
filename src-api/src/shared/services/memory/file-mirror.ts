import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { getSetting } from '@/shared/db/operations';
import { createLogger } from '@/shared/utils/logger';

import type { Memory, MemoryCategory, MemoryType, ScopeType } from './types';

const logger = createLogger('MemoryFileMirror');

const INDEX_FILE = 'MEMORY.md';
const FILE_EXT = '.md';

interface ParsedMemoryFile {
  frontmatter: Record<string, string>;
  body: string;
}

export interface MemoryFileRecord {
  path: string;
  memory: Memory;
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

export function getMemoryDirectory(workDir?: string): string {
  const base = expandHome(workDir || getSetting('workDir') || homedir());
  return resolve(base, '.neuma', 'memory');
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'memory';
}

function memoryFilename(memory: Pick<Memory, 'id' | 'category' | 'content'>) {
  return `${memory.category}_${slugify(memory.content)}_${memory.id}${FILE_EXT}`;
}

function escapeFrontmatter(value: unknown): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : String(value);
  if (/[:#\n\r]|^\s|\s$/.test(text)) return JSON.stringify(text);
  return text;
}

function unescapeFrontmatter(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === 'string') return parsed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function descriptionFor(content: string): string {
  const first = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!first) return 'Memory';
  return first.length > 120 ? `${first.slice(0, 117)}...` : first;
}

function memoryToMarkdown(memory: Memory): string {
  const metadata =
    memory.metadata && Object.keys(memory.metadata).length > 0
      ? JSON.stringify(memory.metadata)
      : '';
  const lines = [
    '---',
    `id: ${escapeFrontmatter(memory.id)}`,
    `name: ${escapeFrontmatter(descriptionFor(memory.content))}`,
    `description: ${escapeFrontmatter(descriptionFor(memory.content))}`,
    `type: ${escapeFrontmatter(memory.memoryType)}`,
    `category: ${escapeFrontmatter(memory.category)}`,
    `scope_type: ${escapeFrontmatter(memory.scopeType)}`,
    `scope_id: ${escapeFrontmatter(memory.scopeId ?? '')}`,
    `importance: ${escapeFrontmatter(memory.importance)}`,
    `pinned: ${memory.memoryType === 'pinned' ? 'true' : 'false'}`,
    `confidence: ${escapeFrontmatter(memory.confidence)}`,
    `visibility: ${escapeFrontmatter(memory.visibility)}`,
    `lifecycle_status: ${escapeFrontmatter(memory.lifecycleStatus)}`,
    `created: ${escapeFrontmatter(memory.createdAt)}`,
    `updated: ${escapeFrontmatter(memory.updatedAt)}`,
    `source: ${escapeFrontmatter(memory.source)}`,
    `metadata: ${escapeFrontmatter(metadata)}`,
    '---',
    '',
    memory.content.trim(),
    '',
  ];
  return lines.join('\n');
}

function parseMarkdown(text: string): ParsedMemoryFile | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(text);
  if (!match) return null;
  const frontmatter: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    frontmatter[line.slice(0, idx).trim()] = unescapeFrontmatter(
      line.slice(idx + 1),
    );
  }
  return { frontmatter, body: match[2]!.trim() };
}

// Two concurrent mirror calls in the same millisecond would otherwise share
// a tmp filename — first rename wins, second ENOENTs. randomBytes makes
// collisions astronomically unlikely.
async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, path);
}

async function listMemoryMarkdownFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(FILE_EXT) &&
        entry.name !== INDEX_FILE,
    )
    .map((entry) => join(dir, entry.name))
    .sort();
}

async function removeStaleFiles(
  dir: string,
  memory: Pick<Memory, 'id'>,
  keepPath: string,
): Promise<void> {
  for (const file of await listMemoryMarkdownFiles(dir)) {
    if (file === keepPath) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    const parsed = parseMarkdown(text);
    if (parsed?.frontmatter.id === memory.id) {
      await unlink(file).catch(() => undefined);
    }
  }
}

export async function mirrorMemoryToDisk(
  memory: Memory,
  options?: { skipIndex?: boolean },
): Promise<string> {
  const dir = getMemoryDirectory();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, memoryFilename(memory));
  await writeAtomic(filePath, memoryToMarkdown(memory));
  await removeStaleFiles(dir, memory, filePath);
  if (!options?.skipIndex) {
    await regenerateMemoryIndex();
  }
  return filePath;
}

export async function removeMemoryFromDisk(id: string): Promise<void> {
  const dir = getMemoryDirectory();
  for (const file of await listMemoryMarkdownFiles(dir)) {
    const text = await readFile(file, 'utf8').catch(() => '');
    const parsed = parseMarkdown(text);
    if (parsed?.frontmatter.id === id || basename(file).includes(id)) {
      await unlink(file).catch(() => undefined);
    }
  }
  await regenerateMemoryIndex();
}

export async function readMemoryFiles(): Promise<ParsedMemoryFile[]> {
  const dir = getMemoryDirectory();
  const files = await listMemoryMarkdownFiles(dir);
  const texts = await Promise.all(
    files.map((file) => readFile(file, 'utf8').catch(() => '')),
  );
  const parsed: ParsedMemoryFile[] = [];
  for (const text of texts) {
    const item = parseMarkdown(text);
    if (item?.frontmatter.id) parsed.push(item);
  }
  return parsed;
}

export async function regenerateMemoryIndex(): Promise<void> {
  const dir = getMemoryDirectory();
  await mkdir(dir, { recursive: true });
  const records: {
    file: string;
    description: string;
    category: string;
    importance: number;
    updated: string;
  }[] = [];

  for (const file of await listMemoryMarkdownFiles(dir)) {
    const text = await readFile(file, 'utf8').catch(() => '');
    const parsed = parseMarkdown(text);
    if (!parsed) continue;
    records.push({
      file: basename(file),
      description:
        parsed.frontmatter.description ||
        parsed.frontmatter.name ||
        descriptionFor(parsed.body),
      category: parsed.frontmatter.category || 'other',
      importance: Number(parsed.frontmatter.importance || 0),
      updated: parsed.frontmatter.updated || '',
    });
  }

  records.sort((a, b) => {
    const important = b.importance - a.importance;
    if (important !== 0) return important;
    return b.updated.localeCompare(a.updated);
  });

  const lines = [
    '# Memory',
    '',
    '<!-- This file is generated from sibling memory markdown frontmatter. Do not edit it by hand. -->',
    '',
    ...records.map(
      (record) =>
        `- [${record.description}](./${record.file}) — ${record.category} · ${record.importance.toFixed(2)}`,
    ),
    '',
  ];
  await writeAtomic(join(dir, INDEX_FILE), lines.join('\n'));
}

export async function syncMemoryFilesFromDisk(options?: {
  pruneDeleted?: boolean;
}): Promise<{ updated: number; pruned: number }> {
  const { getMemory, listMemories, updateMemory, deleteMemory } =
    await import('./store');
  const files = await readMemoryFiles();
  const fileIds = new Set<string>();
  let updated = 0;

  for (const file of files) {
    const id = file.frontmatter.id;
    if (!id) continue;
    fileIds.add(id);
    const existing = getMemory(id);
    if (!existing) continue;

    const metadataText = file.frontmatter.metadata;
    let metadata = existing.metadata ?? undefined;
    if (metadataText) {
      try {
        const parsed = JSON.parse(metadataText);
        if (parsed && typeof parsed === 'object') {
          metadata = parsed as Record<string, unknown>;
        }
      } catch {
        logger.warn(`Ignoring invalid memory metadata for ${id}`);
      }
    }

    const next = updateMemory(id, {
      content: file.body,
      category: (file.frontmatter.category || existing.category) as
        | MemoryCategory
        | undefined,
      importance: Number.isFinite(Number(file.frontmatter.importance))
        ? Number(file.frontmatter.importance)
        : existing.importance,
      memoryType: (file.frontmatter.pinned === 'true'
        ? 'pinned'
        : file.frontmatter.type || existing.memoryType) as MemoryType,
      scopeType: (file.frontmatter.scope_type || existing.scopeType) as
        | ScopeType
        | undefined,
      scopeId: file.frontmatter.scope_id || undefined,
      confidence: Number.isFinite(Number(file.frontmatter.confidence))
        ? Number(file.frontmatter.confidence)
        : existing.confidence,
      lifecycleStatus:
        file.frontmatter.lifecycle_status === 'stale' ||
        file.frontmatter.lifecycle_status === 'archived'
          ? file.frontmatter.lifecycle_status
          : 'active',
      visibility:
        file.frontmatter.visibility === 'team' ? 'team' : existing.visibility,
      metadata,
    });
    if (next) updated++;
  }

  let pruned = 0;
  if (options?.pruneDeleted) {
    for (const memory of listMemories({ limit: 10_000 })) {
      if (fileIds.size > 0 && !fileIds.has(memory.id)) {
        if (deleteMemory(memory.id)) pruned++;
      }
    }
  }

  await regenerateMemoryIndex();
  return { updated, pruned };
}

export async function mirrorAllMemoriesToDisk(): Promise<number> {
  const { listMemories } = await import('./store');
  const memories = listMemories({ limit: 10_000 });
  for (const memory of memories) {
    await mirrorMemoryToDisk(memory, { skipIndex: true });
  }
  await regenerateMemoryIndex();
  return memories.length;
}
