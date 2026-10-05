/**
 * Structured arguments to the argv the vendored script already accepts.
 *
 * Spellings come only from `input_schema.properties[].cli` and
 * `mcp.argument_exceptions`. A key whose contract spelling is not the
 * underscore-to-hyphen default uses the exception the contract records.
 */

import type { ContractProperty, ContractTool } from './contract';
import { FfmpegSkillError } from './errors';

export type SkillArgValue = string | number | boolean | string[];
export type SkillArgs = Record<string, SkillArgValue>;

const JSON_EXEMPT_TOOLS = new Set(['look', 'probe']);

/** Host ceiling. The contract's own default is 1800s and 0 means unlimited. */
export const MAX_TOOL_TIMEOUT_SECONDS = 1800;

export interface PreparedArgs {
  tool: ContractTool;
  args: SkillArgs;
  argv: string[];
}

export function prepareArgs(tool: ContractTool, raw: unknown): PreparedArgs {
  const args = validateArgs(tool, raw);
  return { tool, args, argv: buildArgv(tool, args) };
}

export function validateArgs(tool: ContractTool, raw: unknown): SkillArgs {
  if (raw === undefined || raw === null) raw = {};
  if (!isPlainObject(raw)) {
    throw new FfmpegSkillError(
      'input',
      `${tool.name} arguments must be an object.`,
    );
  }
  if ('argv' in raw) {
    throw new FfmpegSkillError(
      'unsupported',
      `${tool.name} does not accept raw argv. Pass the structured arguments from its catalog entry.`,
    );
  }
  const schema = tool.input_schema;
  const args: SkillArgs = {};
  for (const [key, value] of Object.entries(raw)) {
    const property = schema.properties[key];
    if (!property) {
      throw new FfmpegSkillError(
        'input',
        `${tool.name} does not accept "${key}".`,
      );
    }
    args[key] = coerceProperty(tool.name, key, property, value);
  }
  for (const required of schema.required) {
    if (args[required] === undefined) {
      throw new FfmpegSkillError(
        'input',
        `${tool.name} requires "${required}".`,
      );
    }
  }
  for (const group of schema.one_of_required ?? []) {
    if (!group.some((key) => args[key] !== undefined && args[key] !== false)) {
      throw new FfmpegSkillError(
        'input',
        `${tool.name} requires one of: ${group.join(', ')}.`,
      );
    }
  }
  for (const group of schema.mutually_exclusive ?? []) {
    const present = group.filter(
      (key) => args[key] !== undefined && args[key] !== false,
    );
    if (present.length > 1) {
      throw new FfmpegSkillError(
        'input',
        `${tool.name} accepts only one of: ${present.join(', ')}.`,
      );
    }
  }
  const timeout = args.timeout;
  if (typeof timeout === 'number') {
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new FfmpegSkillError(
        'input',
        `${tool.name} timeout must be a non-negative number of seconds.`,
      );
    }
    if (timeout === 0 || timeout > MAX_TOOL_TIMEOUT_SECONDS) {
      throw new FfmpegSkillError(
        'unsupported',
        `${tool.name} timeout must be between 1 and ${MAX_TOOL_TIMEOUT_SECONDS} seconds. Unlimited timeouts are not available.`,
      );
    }
  }
  return args;
}

function coerceProperty(
  toolName: string,
  key: string,
  property: ContractProperty,
  value: unknown,
): SkillArgValue {
  const where = `${toolName}.${key}`;
  switch (property.type) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new FfmpegSkillError('input', `${where} must be a boolean.`);
      }
      return value;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new FfmpegSkillError('input', `${where} must be an integer.`);
      }
      return value;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new FfmpegSkillError(
          'input',
          `${where} must be a finite number.`,
        );
      }
      return value;
    case 'string':
      if (typeof value !== 'string') {
        throw new FfmpegSkillError('input', `${where} must be a string.`);
      }
      if (value.includes('\0')) {
        throw new FfmpegSkillError('input', `${where} contains a null byte.`);
      }
      if (property.enum && !property.enum.includes(value)) {
        throw new FfmpegSkillError(
          'input',
          `${where} must be one of: ${property.enum.join(', ')}.`,
        );
      }
      return value;
    case 'array': {
      if (
        !Array.isArray(value) ||
        value.some((item) => typeof item !== 'string')
      ) {
        throw new FfmpegSkillError(
          'input',
          `${where} must be an array of strings.`,
        );
      }
      if (value.some((item) => item.includes('\0'))) {
        throw new FfmpegSkillError('input', `${where} contains a null byte.`);
      }
      return value;
    }
    default:
      throw new FfmpegSkillError(
        'missing_runtime',
        `${where} has an unsupported contract type.`,
      );
  }
}

/**
 * Map validated arguments onto argv.
 *
 * Positionals come first, in contract order. Every other key uses the
 * contract's exception spelling when one exists, otherwise the long option
 * derived the way the contract documents it.
 */
export function buildArgv(tool: ContractTool, args: SkillArgs): string[] {
  const argv: string[] = [];
  const remaining = { ...args };
  for (const key of tool.input_schema.positional) {
    const value = remaining[key];
    delete remaining[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) argv.push(...value);
    else if (value !== false) argv.push(String(value));
  }
  for (const [key, value] of Object.entries(remaining)) {
    if (value === undefined || value === false) continue;
    const flag = flagFor(tool, key);
    if (value === true) {
      argv.push(flag);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) argv.push(flag, item);
      continue;
    }
    argv.push(flag, String(value));
  }
  if (
    !JSON_EXEMPT_TOOLS.has(tool.name) &&
    !argv.includes('--json') &&
    !argv.includes('--help')
  ) {
    argv.push('--json');
  }
  return argv;
}

function flagFor(tool: ContractTool, key: string): string {
  const exception = tool.mcp.argument_exceptions[key];
  if (exception) return exception;
  const property = tool.input_schema.properties[key];
  if (!property || property.cli === 'positional') {
    throw new FfmpegSkillError(
      'missing_runtime',
      `${tool.name}.${key} has no CLI spelling in the contract.`,
    );
  }
  const derived = `--${key.replaceAll('_', '-')}`;
  if (property.cli.includes(derived)) return derived;
  const long = property.cli.find((spelling) => spelling.startsWith('--'));
  const fallback = long ?? property.cli[0];
  if (!fallback) {
    throw new FfmpegSkillError(
      'missing_runtime',
      `${tool.name}.${key} has an empty CLI spelling.`,
    );
  }
  return fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
