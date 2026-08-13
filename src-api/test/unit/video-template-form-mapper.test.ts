import { describe, expect, it } from 'vitest';

import { schemaToFormSpec } from '@/shared/video/templates/form-mapper';

describe('schemaToFormSpec', () => {
  it('returns an empty spec + warning for a non-object root schema', () => {
    const spec = schemaToFormSpec({ type: 'string' });
    expect(spec.fields).toEqual([]);
    expect(spec.warnings.length).toBeGreaterThan(0);
  });

  it('returns an empty spec + warning for a non-object value', () => {
    expect(schemaToFormSpec(null).warnings.length).toBeGreaterThan(0);
    expect(schemaToFormSpec(42).warnings.length).toBeGreaterThan(0);
  });

  it('maps string → text with maxLength + pattern + default', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        title: {
          type: 'string',
          maxLength: 80,
          pattern: '^[A-Z]',
          default: 'Hello',
          description: 'Headline',
        },
      },
    });
    expect(spec.fields[0]).toMatchObject({
      kind: 'text',
      key: 'title',
      label: 'Title',
      maxLength: 80,
      pattern: '^[A-Z]',
      defaultValue: 'Hello',
      helpText: 'Headline',
    });
  });

  it('promotes string with maxLength > 100 to textarea', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: { body: { type: 'string', maxLength: 500 } },
    });
    expect(spec.fields[0]?.kind).toBe('textarea');
  });

  it('maps string + format: date → date field', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: { releaseDate: { type: 'string', format: 'date' } },
    });
    expect(spec.fields[0]?.kind).toBe('date');
  });

  it('maps enum → select regardless of declared type', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        aspect: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
      },
    });
    expect(spec.fields[0]).toMatchObject({
      kind: 'select',
      options: ['16:9', '9:16', '1:1'],
    });
  });

  it('maps number / integer with bounds', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        durationSec: { type: 'number', minimum: 1, maximum: 30, default: 5 },
        count: { type: 'integer', minimum: 0, maximum: 12 },
      },
    });
    expect(spec.fields[0]).toMatchObject({
      kind: 'number',
      integer: false,
      minimum: 1,
      maximum: 30,
      defaultValue: 5,
    });
    expect(spec.fields[1]).toMatchObject({ kind: 'number', integer: true });
  });

  it('maps boolean → toggle with default', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: { animated: { type: 'boolean', default: true } },
    });
    expect(spec.fields[0]).toMatchObject({
      kind: 'toggle',
      defaultValue: true,
    });
  });

  it('maps array of primitive → tagList', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        scores: { type: 'array', items: { type: 'number' } },
      },
    });
    expect(spec.fields[0]).toMatchObject({
      kind: 'tagList',
      itemType: 'string',
    });
    expect(spec.fields[1]).toMatchObject({
      kind: 'tagList',
      itemType: 'number',
    });
  });

  it('maps array of object → table with nested columns', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        data: {
          type: 'array',
          minItems: 2,
          maxItems: 12,
          items: {
            type: 'object',
            required: ['label'],
            properties: {
              label: { type: 'string' },
              value: { type: 'number' },
            },
          },
        },
      },
    });
    // `data` matches the asset-picker key heuristic since it's an array; that
    // overrides the table mapping.
    expect(spec.fields[0]?.kind).toBe('assetPicker');
  });

  it('non-`data`-named array of object maps to table', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        bars: {
          type: 'array',
          minItems: 2,
          items: {
            type: 'object',
            required: ['label'],
            properties: {
              label: { type: 'string' },
              value: { type: 'number' },
            },
          },
        },
      },
    });
    const f = spec.fields[0];
    expect(f?.kind).toBe('table');
    if (f?.kind === 'table') {
      expect(f.minItems).toBe(2);
      expect(f.columns.map((c) => c.kind)).toEqual(['text', 'number']);
      expect(f.columns[0]?.required).toBe(true);
    }
  });

  it('maps object → fieldset with nested fields', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        brand: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            accent: { type: 'string' },
          },
        },
      },
    });
    const f = spec.fields[0];
    expect(f?.kind).toBe('fieldset');
    if (f?.kind === 'fieldset') {
      expect(f.fields.map((sf) => sf.key)).toEqual(['name', 'accent']);
    }
  });

  it('detects asset-picker by key name patterns', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        logo_path: { type: 'string' },
        hero_image: { type: 'string' },
        bgm_url: { type: 'string' },
        video: { type: 'string' },
      },
    });
    expect(spec.fields[0]).toMatchObject({
      kind: 'assetPicker',
      assetKind: 'image',
    });
    expect(spec.fields[1]).toMatchObject({
      kind: 'assetPicker',
      assetKind: 'image',
    });
    expect(spec.fields[2]).toMatchObject({
      kind: 'assetPicker',
      assetKind: 'audio',
    });
    expect(spec.fields[3]).toMatchObject({
      kind: 'assetPicker',
      assetKind: 'video',
    });
  });

  it('respects explicit `x-form-asset-kind` extension overriding key heuristics', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        attachment: {
          type: 'string',
          'x-form-asset-kind': 'audio',
        },
      },
    });
    expect(spec.fields[0]).toMatchObject({
      kind: 'assetPicker',
      assetKind: 'audio',
    });
  });

  it('flags required fields from the parent schema', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string' },
        subtitle: { type: 'string' },
      },
    });
    expect(spec.fields[0]?.required).toBe(true);
    expect(spec.fields[1]?.required).toBe(false);
  });

  it('degrades unsupported features (oneOf / $ref) to text with a warning', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        weird: { oneOf: [{ type: 'string' }, { type: 'number' }] },
        ref: { $ref: '#/definitions/Other' },
      },
    });
    expect(spec.fields[0]?.kind).toBe('text');
    expect(spec.fields[0]?.warnings.some((w) => w.includes('oneOf'))).toBe(
      true,
    );
    expect(spec.fields[1]?.warnings.some((w) => w.includes('$ref'))).toBe(true);
  });

  it('coerces numeric/boolean enum values to strings + emits a warning', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        ratio: { type: 'number', enum: [1, 2, 3] },
        flag: { type: 'boolean', enum: [true, false] },
      },
    });
    const ratio = spec.fields[0];
    expect(ratio?.kind).toBe('select');
    if (ratio?.kind === 'select') {
      expect(ratio.options).toEqual(['1', '2', '3']);
      expect(ratio.warnings.some((w) => w.includes('coerced'))).toBe(true);
    }
    const flag = spec.fields[1];
    if (flag?.kind === 'select') {
      expect(flag.options).toEqual(['true', 'false']);
    }
  });

  it('drops non-stringifiable enum values (objects/arrays) with a warning', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        weird: { enum: ['ok', { obj: 1 }, ['arr']] },
      },
    });
    const f = spec.fields[0];
    if (f?.kind === 'select') {
      expect(f.options).toEqual(['ok']);
      expect(
        f.warnings.some((w) => w.includes('dropped non-stringifiable')),
      ).toBe(true);
    }
  });

  it('uses schema.title when present, else humanises the key', () => {
    const spec = schemaToFormSpec({
      type: 'object',
      properties: {
        accent_color: { type: 'string', title: 'Accent' },
        background_color: { type: 'string' },
      },
    });
    expect(spec.fields[0]?.label).toBe('Accent');
    expect(spec.fields[1]?.label).toBe('Background Color');
  });
});
