// Phase 3 M3 — JSON Schema (Draft 2020-12) → FormSpec mapper.
//
// Pure function. Shared by:
//   - the agent's variable validator (Slice D) — same field types, same defaults.
//   - the Phase 6 M2 variable form UI — renders this FormSpec directly.
//
// See dev-doc/html-video/06-05/03-template-gallery-and-provenance.md and
//     dev-doc/html-video/06-06/04-slice-C-templates-and-forms.md.

/** Asset kinds the picker can bind to in the Video Mode media library. */
export type AssetPickerKind = 'image' | 'audio' | 'video' | 'data';

interface BaseField {
  key: string;
  label: string;
  required: boolean;
  helpText?: string;
  warnings: string[];
}

export type FormField =
  | (BaseField & {
      kind: 'text';
      defaultValue?: string;
      maxLength?: number;
      pattern?: string;
    })
  | (BaseField & {
      kind: 'textarea';
      defaultValue?: string;
      maxLength?: number;
    })
  | (BaseField & { kind: 'select'; defaultValue?: string; options: string[] })
  | (BaseField & { kind: 'date'; defaultValue?: string })
  | (BaseField & {
      kind: 'number';
      defaultValue?: number;
      minimum?: number;
      maximum?: number;
      integer: boolean;
    })
  | (BaseField & { kind: 'toggle'; defaultValue?: boolean })
  | (BaseField & { kind: 'tagList'; itemType: 'string' | 'number' })
  | (BaseField & {
      kind: 'table';
      columns: FormField[];
      minItems?: number;
      maxItems?: number;
    })
  | (BaseField & { kind: 'fieldset'; fields: FormField[] })
  | (BaseField & { kind: 'assetPicker'; assetKind: AssetPickerKind });

export interface FormSpec {
  type: 'object';
  fields: FormField[];
  /** Top-level warnings — emitted for schema features the mapper can't represent. */
  warnings: string[];
}

interface JsonSchemaLike {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  enum?: unknown[];
  format?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  default?: unknown;
  description?: string;
  title?: string;
  items?: JsonSchemaLike | JsonSchemaLike[];
  minItems?: number;
  maxItems?: number;
  /** Custom extension on a property: explicit asset-picker kind override. */
  'x-form-asset-kind'?: AssetPickerKind;
  // Unsupported features we detect to emit a warning:
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
  $ref?: string;
  if?: unknown;
  then?: unknown;
  else?: unknown;
}

const TEXTAREA_MAX_LENGTH_THRESHOLD = 100;

/**
 * Map a JSON Schema for a template's `inputs.schema` to a FormSpec.
 * Returns an empty FormSpec with a top-level warning when the schema isn't
 * an `object` schema (every supported template wraps inputs in `type: object`).
 */
export function schemaToFormSpec(schema: unknown): FormSpec {
  const root = isObjectLike(schema) ? (schema as JsonSchemaLike) : {};
  const warnings: string[] = [];
  if (root.type !== 'object') {
    warnings.push(
      'schemaToFormSpec: root schema is not `type: object`; returning an empty form spec.',
    );
    return { type: 'object', fields: [], warnings };
  }
  const required = new Set(root.required ?? []);
  const fields: FormField[] = [];
  for (const [key, propSchema] of Object.entries(root.properties ?? {})) {
    fields.push(mapField(key, propSchema, required.has(key)));
  }
  return { type: 'object', fields, warnings };
}

function mapField(
  key: string,
  schema: JsonSchemaLike,
  required: boolean,
): FormField {
  const baseFieldWarnings: string[] = [];
  const helpText = schema.description;
  const label = schema.title ?? humaniseKey(key);

  // Detect features the mapper can't represent end-to-end; the field still
  // renders (as text) but the warning surfaces in the FormSpec.
  for (const feature of ['oneOf', 'anyOf', 'allOf', '$ref', 'if'] as const) {
    if (schema[feature] !== undefined) {
      baseFieldWarnings.push(
        `field "${key}": "${feature}" is not supported — degrading to text input.`,
      );
    }
  }

  // Asset-picker takes precedence — surfaced by key name or explicit extension.
  const assetKind = detectAssetPickerKind(key, schema);
  if (assetKind) {
    return {
      key,
      label,
      required,
      helpText,
      warnings: baseFieldWarnings,
      kind: 'assetPicker',
      assetKind,
    };
  }

  const declaredType = Array.isArray(schema.type)
    ? schema.type[0]
    : schema.type;

  // enum first — overrides primitive type detection. JSON Schema allows
  // numeric/boolean enum values; we stringify them for display (the form
  // UI submits strings) and emit a warning so the caller knows the values
  // were coerced rather than silently lost.
  if (Array.isArray(schema.enum)) {
    const enumWarnings = [...baseFieldWarnings];
    const options: string[] = [];
    let coercedAny = false;
    for (const v of schema.enum) {
      if (typeof v === 'string') {
        options.push(v);
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        options.push(String(v));
        coercedAny = true;
      } else {
        enumWarnings.push(
          `field "${key}": dropped non-stringifiable enum value of type "${typeof v}".`,
        );
      }
    }
    if (coercedAny) {
      enumWarnings.push(
        `field "${key}": numeric/boolean enum values were coerced to strings for form display.`,
      );
    }
    return {
      key,
      label,
      required,
      helpText,
      warnings: enumWarnings,
      kind: 'select',
      defaultValue: schema.default == null ? undefined : String(schema.default),
      options,
    };
  }

  if (declaredType === 'string') {
    if (schema.format === 'date') {
      return {
        key,
        label,
        required,
        helpText,
        warnings: baseFieldWarnings,
        kind: 'date',
        defaultValue: schema.default as string | undefined,
      };
    }
    if (
      schema.maxLength != null &&
      schema.maxLength > TEXTAREA_MAX_LENGTH_THRESHOLD
    ) {
      return {
        key,
        label,
        required,
        helpText,
        warnings: baseFieldWarnings,
        kind: 'textarea',
        defaultValue: schema.default as string | undefined,
        maxLength: schema.maxLength,
      };
    }
    return {
      key,
      label,
      required,
      helpText,
      warnings: baseFieldWarnings,
      kind: 'text',
      defaultValue: schema.default as string | undefined,
      maxLength: schema.maxLength,
      pattern: schema.pattern,
    };
  }

  if (declaredType === 'number' || declaredType === 'integer') {
    return {
      key,
      label,
      required,
      helpText,
      warnings: baseFieldWarnings,
      kind: 'number',
      defaultValue: schema.default as number | undefined,
      minimum: schema.minimum,
      maximum: schema.maximum,
      integer: declaredType === 'integer',
    };
  }

  if (declaredType === 'boolean') {
    return {
      key,
      label,
      required,
      helpText,
      warnings: baseFieldWarnings,
      kind: 'toggle',
      defaultValue: schema.default as boolean | undefined,
    };
  }

  if (declaredType === 'array') {
    const itemSchema =
      (Array.isArray(schema.items) ? schema.items[0] : schema.items) ?? {};
    const itemType = Array.isArray(itemSchema.type)
      ? itemSchema.type[0]
      : itemSchema.type;
    if (itemType === 'object') {
      const columnFields: FormField[] = [];
      const required = new Set(itemSchema.required ?? []);
      for (const [colKey, colSchema] of Object.entries(
        itemSchema.properties ?? {},
      )) {
        columnFields.push(mapField(colKey, colSchema, required.has(colKey)));
      }
      return {
        key,
        label,
        required: Boolean(schema.minItems && schema.minItems > 0),
        helpText,
        warnings: baseFieldWarnings,
        kind: 'table',
        columns: columnFields,
        minItems: schema.minItems,
        maxItems: schema.maxItems,
      };
    }
    if (
      itemType === 'string' ||
      itemType === 'number' ||
      itemType === 'integer'
    ) {
      return {
        key,
        label,
        required: Boolean(schema.minItems && schema.minItems > 0),
        helpText,
        warnings: baseFieldWarnings,
        kind: 'tagList',
        itemType: itemType === 'string' ? 'string' : 'number',
      };
    }
    // Unknown array item — degrade to text with a warning.
    return {
      key,
      label,
      required,
      helpText,
      warnings: [
        ...baseFieldWarnings,
        `field "${key}": array items have no recognised type — degrading to text input.`,
      ],
      kind: 'text',
    };
  }

  if (declaredType === 'object') {
    const subRequired = new Set(schema.required ?? []);
    const subFields: FormField[] = [];
    for (const [subKey, subSchema] of Object.entries(schema.properties ?? {})) {
      subFields.push(mapField(subKey, subSchema, subRequired.has(subKey)));
    }
    return {
      key,
      label,
      required,
      helpText,
      warnings: baseFieldWarnings,
      kind: 'fieldset',
      fields: subFields,
    };
  }

  // Unknown / missing type → text with a warning.
  return {
    key,
    label,
    required,
    helpText,
    warnings: [
      ...baseFieldWarnings,
      `field "${key}": schema "type" is missing or unrecognised — degrading to text input.`,
    ],
    kind: 'text',
  };
}

/**
 * Detect the asset-picker kind from a property key (and an optional explicit
 * `x-form-asset-kind` extension). Returns undefined when the key doesn't
 * match any pattern and the schema doesn't declare an explicit kind.
 */
function detectAssetPickerKind(
  key: string,
  schema: JsonSchemaLike,
): AssetPickerKind | undefined {
  if (schema['x-form-asset-kind']) return schema['x-form-asset-kind'];
  const lower = key.toLowerCase();
  if (
    lower.endsWith('_image') ||
    lower.endsWith('_logo') ||
    lower.startsWith('logo_') ||
    lower === 'logo' ||
    lower === 'image'
  ) {
    return 'image';
  }
  if (
    lower.startsWith('bgm_') ||
    lower.endsWith('_audio') ||
    lower === 'audio' ||
    lower === 'bgm'
  ) {
    return 'audio';
  }
  if (lower.endsWith('_video') || lower === 'video') {
    return 'video';
  }
  // Only treat `data` keys as data assets when the schema declares an
  // object/array — a plain scalar `data` is just a numeric input.
  const declaredType = Array.isArray(schema.type)
    ? schema.type[0]
    : schema.type;
  if (
    (lower === 'data' || lower.endsWith('_data')) &&
    (declaredType === 'object' || declaredType === 'array')
  ) {
    return 'data';
  }
  return undefined;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function humaniseKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
