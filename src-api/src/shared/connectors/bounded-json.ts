export type BoundedJsonPrimitive = string | number | boolean | null;
export type BoundedJsonArray = BoundedJsonValue[];
export type BoundedJsonObject = { [key: string]: BoundedJsonValue };
export type BoundedJsonValue =
  | BoundedJsonPrimitive
  | BoundedJsonArray
  | BoundedJsonObject;

export interface ConnectorJsonLimits {
  maxDepth: number;
  maxKeysPerObject: number;
  maxArrayLength: number;
  maxStringBytes: number;
  maxSerializedBytes: number;
}

export const CONNECTOR_JSON_LIMITS: ConnectorJsonLimits = {
  maxDepth: 8,
  maxKeysPerObject: 100,
  maxArrayLength: 500,
  maxStringBytes: 16 * 1024,
  maxSerializedBytes: 256 * 1024,
};

const FORBIDDEN_KEY_PATTERN =
  /^(?:api[-_]?key|authorization|bearer|client[-_]?secret|password|private[-_]?key|secret|token|access[-_]?token|refresh[-_]?token)$/i;

export type ConnectorJsonIssueCode =
  | 'not_json'
  | 'schema_mismatch'
  | 'too_deep'
  | 'too_many_keys'
  | 'array_too_large'
  | 'string_too_large'
  | 'serialized_too_large'
  | 'forbidden_key';

export class ConnectorJsonError extends Error {
  readonly code: ConnectorJsonIssueCode;
  readonly path: string;

  constructor(code: ConnectorJsonIssueCode, message: string, path = '$') {
    super(message);
    this.name = 'ConnectorJsonError';
    this.code = code;
    this.path = path;
  }
}

export interface NormalizeConnectorJsonOptions {
  limits?: ConnectorJsonLimits;
  redactForbiddenKeys?: boolean;
}

export function cloneBoundedJsonValue(
  value: BoundedJsonValue,
): BoundedJsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => cloneBoundedJsonValue(item));
  }

  if (isPlainJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        cloneBoundedJsonValue(entry),
      ]),
    );
  }

  return value;
}

export function cloneBoundedJsonObject(
  value: BoundedJsonObject,
): BoundedJsonObject {
  return cloneBoundedJsonValue(value) as BoundedJsonObject;
}

export function normalizeConnectorJsonValue(
  value: unknown,
  options: NormalizeConnectorJsonOptions = {},
): BoundedJsonValue {
  const limits = options.limits ?? CONNECTOR_JSON_LIMITS;
  const normalized = normalizeValue(value, '$', 0, limits, options);
  const serialized = JSON.stringify(normalized);

  if (serialized === undefined) {
    throw new ConnectorJsonError(
      'not_json',
      'Connector value is not JSON serializable',
    );
  }

  if (byteLength(serialized) > limits.maxSerializedBytes) {
    throw new ConnectorJsonError(
      'serialized_too_large',
      `Connector JSON exceeds ${limits.maxSerializedBytes} bytes`,
    );
  }

  return normalized;
}

export function normalizeConnectorJsonObject(
  value: unknown,
  options: NormalizeConnectorJsonOptions = {},
): BoundedJsonObject {
  const normalized = normalizeConnectorJsonValue(value, options);
  if (!isPlainJsonObject(normalized)) {
    throw new ConnectorJsonError(
      'not_json',
      'Connector value must be a JSON object',
    );
  }
  return normalized;
}

export function validateConnectorToolInput(
  input: unknown,
  inputSchemaJson?: BoundedJsonObject,
): BoundedJsonObject {
  const normalized = normalizeConnectorJsonObject(input);
  if (inputSchemaJson) {
    validateJsonSchemaValue(normalized, inputSchemaJson, '$');
  }
  return normalized;
}

export function normalizeConnectorToolOutput(value: unknown): {
  output: BoundedJsonValue;
  truncated: boolean;
} {
  const limits = CONNECTOR_JSON_LIMITS;
  const state = { truncated: false };
  const output = normalizeOutputValue(value, '$', 0, limits, state);
  const serialized = JSON.stringify(output);
  if (
    serialized === undefined ||
    byteLength(serialized) > limits.maxSerializedBytes
  ) {
    return {
      output: {
        _truncated: true,
        message: 'Connector output exceeded the serialized size limit.',
      },
      truncated: true,
    };
  }

  return {
    output,
    truncated: state.truncated,
  };
}

function normalizeValue(
  value: unknown,
  path: string,
  depth: number,
  limits: ConnectorJsonLimits,
  options: NormalizeConnectorJsonOptions,
): BoundedJsonValue {
  if (depth > limits.maxDepth) {
    throw new ConnectorJsonError(
      'too_deep',
      `Connector JSON exceeds max depth ${limits.maxDepth}`,
      path,
    );
  }

  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    if (
      typeof value === 'string' &&
      byteLength(value) > limits.maxStringBytes
    ) {
      throw new ConnectorJsonError(
        'string_too_large',
        `Connector string exceeds ${limits.maxStringBytes} bytes`,
        path,
      );
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new ConnectorJsonError(
        'not_json',
        'Connector number must be finite',
        path,
      );
    }
    return value;
  }

  if (Array.isArray(value)) {
    if (value.length > limits.maxArrayLength) {
      throw new ConnectorJsonError(
        'array_too_large',
        `Connector array exceeds ${limits.maxArrayLength} items`,
        path,
      );
    }

    return value.map((entry, index) =>
      normalizeValue(entry, `${path}[${index}]`, depth + 1, limits, options),
    );
  }

  if (isPlainJsonObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > limits.maxKeysPerObject) {
      throw new ConnectorJsonError(
        'too_many_keys',
        `Connector object exceeds ${limits.maxKeysPerObject} keys`,
        path,
      );
    }

    const normalized: BoundedJsonObject = {};
    for (const [key, entry] of entries) {
      if (isForbiddenCredentialKey(key)) {
        if (options.redactForbiddenKeys) {
          normalized[key] = '[redacted]';
          continue;
        }

        throw new ConnectorJsonError(
          'forbidden_key',
          `Connector JSON contains forbidden credential-like key "${key}"`,
          `${path}.${key}`,
        );
      }

      normalized[key] = normalizeValue(
        entry,
        `${path}.${key}`,
        depth + 1,
        limits,
        options,
      );
    }

    return normalized;
  }

  throw new ConnectorJsonError(
    'not_json',
    'Connector value must be JSON serializable',
    path,
  );
}

function isPlainJsonObject(value: unknown): value is BoundedJsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function normalizeOutputValue(
  value: unknown,
  path: string,
  depth: number,
  limits: ConnectorJsonLimits,
  state: { truncated: boolean },
): BoundedJsonValue {
  if (depth > limits.maxDepth) {
    state.truncated = true;
    return '[truncated]';
  }

  if (value === null || typeof value === 'boolean') return value;

  if (typeof value === 'string') {
    if (byteLength(value) <= limits.maxStringBytes) return value;
    state.truncated = true;
    return truncateUtf8(value, limits.maxStringBytes);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      state.truncated = true;
      return null;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const entries =
      value.length > limits.maxArrayLength
        ? value.slice(0, limits.maxArrayLength)
        : value;
    if (entries.length !== value.length) state.truncated = true;
    return entries.map((entry, index) =>
      normalizeOutputValue(
        entry,
        `${path}[${index}]`,
        depth + 1,
        limits,
        state,
      ),
    );
  }

  if (isPlainJsonObject(value)) {
    const entries = Object.entries(value);
    const maxEntries =
      entries.length > limits.maxKeysPerObject
        ? Math.max(0, limits.maxKeysPerObject - 1)
        : entries.length;
    if (maxEntries !== entries.length) state.truncated = true;

    const normalized: BoundedJsonObject = {};
    for (const [key, entry] of entries.slice(0, maxEntries)) {
      if (isForbiddenCredentialKey(key)) {
        normalized[key] = '[redacted]';
        continue;
      }
      normalized[key] = normalizeOutputValue(
        entry,
        `${path}.${key}`,
        depth + 1,
        limits,
        state,
      );
    }
    if (maxEntries !== entries.length) normalized._truncated = true;
    return normalized;
  }

  state.truncated = true;
  return null;
}

function validateJsonSchemaValue(
  value: BoundedJsonValue,
  schema: BoundedJsonObject,
  path: string,
): void {
  validateCombinators(value, schema, path);
  validateEnum(value, schema, path);

  const types = readSchemaTypes(schema);
  if (
    types.length > 0 &&
    !types.some((type) => schemaTypeMatches(value, type))
  ) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} does not match schema type ${types.join(' | ')}`,
      path,
    );
  }

  if (
    (types.includes('object') && isPlainJsonObject(value)) ||
    (types.length === 0 &&
      (isPlainJsonObject(schema.properties) ||
        Array.isArray(schema.required) ||
        schema.additionalProperties !== undefined))
  ) {
    validateObjectSchema(value, schema, path);
  }

  if (
    (types.includes('array') && Array.isArray(value)) ||
    (types.length === 0 && schema.items !== undefined)
  ) {
    validateArraySchema(value, schema, path);
  }

  if (
    (types.includes('string') && typeof value === 'string') ||
    (types.length === 0 &&
      (typeof schema.minLength === 'number' ||
        typeof schema.maxLength === 'number' ||
        typeof schema.pattern === 'string'))
  ) {
    validateStringSchema(value, schema, path);
  }

  if (
    ((types.includes('number') || types.includes('integer')) &&
      typeof value === 'number') ||
    (types.length === 0 &&
      (typeof schema.minimum === 'number' ||
        typeof schema.maximum === 'number' ||
        typeof schema.exclusiveMinimum === 'number' ||
        typeof schema.exclusiveMaximum === 'number'))
  ) {
    validateNumberSchema(value, schema, path);
  }
}

function validateCombinators(
  value: BoundedJsonValue,
  schema: BoundedJsonObject,
  path: string,
): void {
  const allOf = readSchemaArray(schema.allOf);
  for (const candidate of allOf)
    validateJsonSchemaValue(value, candidate, path);

  const anyOf = readSchemaArray(schema.anyOf);
  if (
    anyOf.length > 0 &&
    !anyOf.some((candidate) => schemaAccepts(value, candidate, path))
  ) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} does not match any allowed schema`,
      path,
    );
  }

  const oneOf = readSchemaArray(schema.oneOf);
  if (oneOf.length > 0) {
    const matches = oneOf.filter((candidate) =>
      schemaAccepts(value, candidate, path),
    ).length;
    if (matches !== 1) {
      throw new ConnectorJsonError(
        'schema_mismatch',
        `Connector input at ${path} must match exactly one allowed schema`,
        path,
      );
    }
  }
}

function validateEnum(
  value: BoundedJsonValue,
  schema: BoundedJsonObject,
  path: string,
): void {
  if (schema.const !== undefined && !jsonEquals(value, schema.const)) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} does not match the required value`,
      path,
    );
  }

  if (!Array.isArray(schema.enum)) return;
  if (!schema.enum.some((entry) => jsonEquals(value, entry))) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} is not an allowed value`,
      path,
    );
  }
}

function validateObjectSchema(
  value: BoundedJsonValue,
  schema: BoundedJsonObject,
  path: string,
): void {
  if (!isPlainJsonObject(value)) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} must be an object`,
      path,
    );
  }

  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : [];
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      throw new ConnectorJsonError(
        'schema_mismatch',
        `Connector input at ${path} is missing required field "${key}"`,
        `${path}.${key}`,
      );
    }
  }

  const properties = isPlainJsonObject(schema.properties)
    ? schema.properties
    : {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!Object.hasOwn(value, key)) continue;
    if (isPlainJsonObject(propertySchema)) {
      validateJsonSchemaValue(value[key]!, propertySchema, `${path}.${key}`);
    }
  }

  const additional = schema.additionalProperties;
  const knownKeys = new Set(Object.keys(properties));
  for (const [key, entry] of Object.entries(value)) {
    if (knownKeys.has(key)) continue;
    if (additional === false) {
      throw new ConnectorJsonError(
        'schema_mismatch',
        `Connector input at ${path} contains unsupported field "${key}"`,
        `${path}.${key}`,
      );
    }
    if (isPlainJsonObject(additional)) {
      validateJsonSchemaValue(entry, additional, `${path}.${key}`);
    }
  }
}

function validateArraySchema(
  value: BoundedJsonValue,
  schema: BoundedJsonObject,
  path: string,
): void {
  if (!Array.isArray(value)) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} must be an array`,
      path,
    );
  }

  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} has too few items`,
      path,
    );
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} has too many items`,
      path,
    );
  }

  if (isPlainJsonObject(schema.items)) {
    value.forEach((entry, index) =>
      validateJsonSchemaValue(
        entry,
        schema.items as BoundedJsonObject,
        `${path}[${index}]`,
      ),
    );
  } else if (Array.isArray(schema.items)) {
    schema.items.forEach((itemSchema, index) => {
      if (index >= value.length || !isPlainJsonObject(itemSchema)) return;
      validateJsonSchemaValue(value[index]!, itemSchema, `${path}[${index}]`);
    });
  }
}

function validateStringSchema(
  value: BoundedJsonValue,
  schema: BoundedJsonObject,
  path: string,
): void {
  if (typeof value !== 'string') {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} must be a string`,
      path,
    );
  }
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} is too short`,
      path,
    );
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} is too long`,
      path,
    );
  }
  if (typeof schema.pattern === 'string') {
    try {
      if (!new RegExp(schema.pattern).test(value)) {
        throw new ConnectorJsonError(
          'schema_mismatch',
          `Connector input at ${path} does not match the required pattern`,
          path,
        );
      }
    } catch (error) {
      if (error instanceof ConnectorJsonError) throw error;
    }
  }
}

function validateNumberSchema(
  value: BoundedJsonValue,
  schema: BoundedJsonObject,
  path: string,
): void {
  if (typeof value !== 'number') {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} must be a number`,
      path,
    );
  }
  if (readSchemaTypes(schema).includes('integer') && !Number.isInteger(value)) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} must be an integer`,
      path,
    );
  }
  if (typeof schema.minimum === 'number' && value < schema.minimum) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} is below the minimum`,
      path,
    );
  }
  if (typeof schema.maximum === 'number' && value > schema.maximum) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} is above the maximum`,
      path,
    );
  }
  if (
    typeof schema.exclusiveMinimum === 'number' &&
    value <= schema.exclusiveMinimum
  ) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} must be greater than the minimum`,
      path,
    );
  }
  if (
    typeof schema.exclusiveMaximum === 'number' &&
    value >= schema.exclusiveMaximum
  ) {
    throw new ConnectorJsonError(
      'schema_mismatch',
      `Connector input at ${path} must be less than the maximum`,
      path,
    );
  }
}

function readSchemaTypes(schema: BoundedJsonObject): string[] {
  if (typeof schema.type === 'string') return [schema.type];
  if (Array.isArray(schema.type)) {
    return schema.type.filter(
      (entry): entry is string => typeof entry === 'string',
    );
  }
  return [];
}

function readSchemaArray(
  value: BoundedJsonValue | undefined,
): BoundedJsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainJsonObject);
}

function schemaAccepts(
  value: BoundedJsonValue,
  schema: BoundedJsonObject,
  path: string,
): boolean {
  try {
    validateJsonSchemaValue(value, schema, path);
    return true;
  } catch {
    return false;
  }
}

function schemaTypeMatches(value: BoundedJsonValue, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainJsonObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function isForbiddenCredentialKey(key: string): boolean {
  return FORBIDDEN_KEY_PATTERN.test(key);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function truncateUtf8(value: string, maxBytes: number): string {
  const marker = '...[truncated]';
  const targetBytes = Math.max(0, maxBytes - byteLength(marker));
  let output = '';
  let used = 0;
  for (const char of value) {
    const charBytes = byteLength(char);
    if (used + charBytes > targetBytes) break;
    output += char;
    used += charBytes;
  }
  return `${output}${marker}`;
}

function jsonEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
