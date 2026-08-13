import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { validatePath } from '@/shared/services/ffmpeg';

import { getVideoRoot, getVideoWorkspaceRoot } from '../store';
import type { VideoTemplate } from './types';
import { VideoTemplateSchema } from './validator';

const TEMPLATE_FILE_EXTENSION = '.json';

export function getCustomTemplatesDir(): string {
  return path.join(getVideoRoot(), 'templates');
}

export async function listCustomTemplates(): Promise<VideoTemplate[]> {
  const dir = validatePath(
    getCustomTemplatesDir(),
    getVideoWorkspaceRoot(),
    'write',
  );
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const templates: VideoTemplate[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(TEMPLATE_FILE_EXTENSION)) continue;
    const raw = await fs.readFile(path.join(dir, entry), 'utf8');
    templates.push(VideoTemplateSchema.parse(JSON.parse(raw)) as VideoTemplate);
  }
  return templates;
}

export async function saveCustomTemplate(
  template: VideoTemplate,
): Promise<VideoTemplate> {
  const parsed = VideoTemplateSchema.parse({
    ...template,
    source: 'custom',
  }) as VideoTemplate;
  const dir = validatePath(
    getCustomTemplatesDir(),
    getVideoWorkspaceRoot(),
    'write',
  );
  await fs.mkdir(dir, { recursive: true });
  const filePath = validatePath(
    path.join(dir, `${parsed.id}${TEMPLATE_FILE_EXTENSION}`),
    getVideoWorkspaceRoot(),
    'write',
  );
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

export async function deleteCustomTemplate(templateId: string): Promise<void> {
  assertSafeTemplateId(templateId);
  const filePath = validatePath(
    path.join(
      getCustomTemplatesDir(),
      `${templateId}${TEMPLATE_FILE_EXTENSION}`,
    ),
    getVideoWorkspaceRoot(),
    'write',
  );
  await fs.unlink(filePath);
}

export function createCustomTemplateId(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `${slug || 'template'}-${randomUUID().slice(0, 8)}`;
}

function assertSafeTemplateId(templateId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{2,100}$/.test(templateId)) {
    throw new Error('Invalid video template id');
  }
}
