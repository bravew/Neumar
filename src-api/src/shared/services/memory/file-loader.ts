import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { getMemoryDirectory } from './file-mirror';

export interface LoadedMemoryFile {
  path: string;
  content: string;
  ageDays: number;
}

function parseUpdatedAt(text: string): string | null {
  const match = /^updated:\s*(.+)$/m.exec(text);
  return match?.[1]?.trim().replace(/^"|"$/g, '') ?? null;
}

function parseImportance(text: string): number {
  const match = /^importance:\s*(.+)$/m.exec(text);
  const value = Number(match?.[1]?.trim());
  return Number.isFinite(value) ? value : 0;
}

function ageDays(updatedAt: string | null): number {
  if (!updatedAt) return 0;
  const ms = Date.now() - new Date(updatedAt).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

export async function loadMemoryFiles(options?: {
  maxFiles?: number;
  maxChars?: number;
}): Promise<LoadedMemoryFile[]> {
  const dir = getMemoryDirectory();
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.md') &&
        entry.name !== 'MEMORY.md',
    )
    .map((entry) => join(dir, entry.name));

  const loaded = (
    await Promise.all(
      files.map(async (path) => {
        const text = await readFile(path, 'utf8');
        return {
          path,
          text,
          importance: parseImportance(text),
          ageDays: ageDays(parseUpdatedAt(text)),
        };
      }),
    )
  ).sort((a, b) => b.importance - a.importance);

  const maxFiles = options?.maxFiles ?? 20;
  const maxChars = options?.maxChars ?? 16_000;
  const result: LoadedMemoryFile[] = [];
  let chars = 0;
  for (const item of loaded) {
    if (result.length >= maxFiles || chars >= maxChars) break;
    const reminder =
      item.ageDays > 0
        ? `<system-reminder>This memory is ${item.ageDays} days old; verify it against current project state before relying on it.</system-reminder>\n\n`
        : '';
    const content = `## ${basename(item.path)}\n\n${reminder}${item.text.trim()}`;
    result.push({ path: item.path, content, ageDays: item.ageDays });
    chars += content.length;
  }
  return result;
}

export function formatLoadedMemoryFiles(files: LoadedMemoryFile[]): string {
  if (files.length === 0) return '';
  return `# Memory\n\n${files.map((file) => file.content).join('\n\n')}\n`;
}
