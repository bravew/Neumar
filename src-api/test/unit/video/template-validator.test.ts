import { describe, expect, it } from 'vitest';

import { BUILTIN_VIDEO_TEMPLATES } from '@/shared/video/templates/builtin';
import { VideoTemplateSchema } from '@/shared/video/templates/validator';

describe('VideoTemplateSchema provenance fields', () => {
  it('still validates a built-in template', () => {
    const template = BUILTIN_VIDEO_TEMPLATES[0]!;
    expect(VideoTemplateSchema.parse(template).id).toBe(template.id);
  });

  it('accepts optional frameworkProvenance and scene role/slotId', () => {
    const template = BUILTIN_VIDEO_TEMPLATES[0]!;
    const parsed = VideoTemplateSchema.parse({
      ...template,
      id: 'custom-framework-template',
      source: 'custom',
      frameworkProvenance: {
        referenceId: 'ref-read1',
        extractedAt: '2026-09-15T00:00:00.000Z',
        extractedBy: 'test',
      },
      storyboardSeed: {
        ...template.storyboardSeed,
        scenes: template.storyboardSeed.scenes.map((scene) => ({
          ...scene,
          slotId: 'slot-1',
          role: 'hook',
        })),
      },
    });
    expect(parsed.frameworkProvenance?.referenceId).toBe('ref-read1');
    expect(parsed.storyboardSeed.scenes[0]?.role).toBe('hook');
  });
});
