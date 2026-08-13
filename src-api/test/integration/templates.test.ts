import crypto from 'crypto';

import { describe, expect, it } from 'vitest';

import {
  createUserTemplate,
  deleteUserTemplate,
  getAllUserTemplates,
  getUserTemplate,
  updateUserTemplate,
} from '@/shared/db/operations';

describe('User Templates', () => {
  const makeTemplate = (overrides?: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    name: 'Test Template',
    category: 'dev' as const,
    system_prompt: 'You are a helpful assistant.',
    starter_prompts: JSON.stringify(['Hello', 'Help me']),
    ...overrides,
  });

  describe('CRUD', () => {
    it('creates a user template', () => {
      const input = makeTemplate({ name: 'CRUD-Create' });
      const template = createUserTemplate(input);
      expect(template.id).toBe(input.id);
      expect(template.name).toBe('CRUD-Create');
      expect(template.category).toBe('dev');
      expect(template.is_built_in).toBe(0);
    });

    it('reads a user template', () => {
      const input = makeTemplate({ name: 'CRUD-Read' });
      createUserTemplate(input);
      const template = getUserTemplate(input.id);
      expect(template).not.toBeNull();
      expect(template!.name).toBe('CRUD-Read');
    });

    it('updates a user template', () => {
      const input = makeTemplate({ name: 'CRUD-Update' });
      createUserTemplate(input);
      const updated = updateUserTemplate(input.id, {
        name: 'Updated Name',
        description: 'A new description',
      });
      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('A new description');
    });

    it('deletes a user template', () => {
      const input = makeTemplate({ name: 'CRUD-Delete' });
      createUserTemplate(input);
      deleteUserTemplate(input.id);
      const template = getUserTemplate(input.id);
      expect(template).toBeNull();
    });
  });

  describe('Category filter', () => {
    it('filters by category', () => {
      const devId = crypto.randomUUID();
      const writingId = crypto.randomUUID();
      createUserTemplate(
        makeTemplate({ id: devId, name: 'Dev T', category: 'dev' }),
      );
      createUserTemplate(
        makeTemplate({
          id: writingId,
          name: 'Writing T',
          category: 'writing',
        }),
      );

      const devTemplates = getAllUserTemplates('dev');
      expect(devTemplates.some((t) => t.id === devId)).toBe(true);
      expect(devTemplates.some((t) => t.id === writingId)).toBe(false);
    });
  });

  describe('Export/Import round-trip', () => {
    it('preserves all fields', () => {
      const input = makeTemplate({
        name: 'Export Test',
        description: 'desc',
        suggested_model: 'claude-sonnet',
        skills: '["review"]',
        icon: 'FileText',
      });
      const created = createUserTemplate(input);

      // "Export" = read the template
      const exported = getUserTemplate(created.id);
      expect(exported).not.toBeNull();
      expect(exported!.name).toBe('Export Test');
      expect(exported!.description).toBe('desc');
      expect(exported!.suggested_model).toBe('claude-sonnet');
      expect(exported!.skills).toBe('["review"]');
      expect(exported!.icon).toBe('FileText');

      // "Import" = create with new ID
      const importId = crypto.randomUUID();
      const imported = createUserTemplate({
        ...input,
        id: importId,
        name: exported!.name,
        description: exported!.description ?? undefined,
        suggested_model: exported!.suggested_model ?? undefined,
        skills: exported!.skills ?? undefined,
        icon: exported!.icon ?? undefined,
      });
      expect(imported.name).toBe('Export Test');
      expect(imported.description).toBe('desc');
    });
  });
});
