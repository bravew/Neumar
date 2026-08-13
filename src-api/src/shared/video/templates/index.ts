import { BUILTIN_VIDEO_TEMPLATES } from './builtin';
import {
  deleteCustomTemplate,
  listCustomTemplates,
  saveCustomTemplate,
} from './custom-loader';
import type { VideoTemplate } from './types';
import { VideoTemplateSchema } from './validator';

export async function listVideoTemplates(): Promise<VideoTemplate[]> {
  const custom = await listCustomTemplates();
  return [...BUILTIN_VIDEO_TEMPLATES, ...custom].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

export async function getVideoTemplate(
  templateId: string,
): Promise<VideoTemplate> {
  const template = (await listVideoTemplates()).find(
    (candidate) => candidate.id === templateId,
  );
  if (!template) throw new Error('Video template not found');
  return template;
}

export async function createCustomVideoTemplate(
  input: unknown,
): Promise<VideoTemplate> {
  const parsed = VideoTemplateSchema.parse(input) as VideoTemplate;
  if (parsed.source === 'builtin') {
    throw new Error('Custom templates may not use builtin source');
  }
  return saveCustomTemplate({ ...parsed, source: 'custom' });
}

export async function removeCustomVideoTemplate(
  templateId: string,
): Promise<void> {
  const template = await getVideoTemplate(templateId);
  if (template.source !== 'custom') {
    throw new Error('Only custom video templates can be removed');
  }
  await deleteCustomTemplate(templateId);
}

export type { VideoTemplate } from './types';
