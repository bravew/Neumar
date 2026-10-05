/**
 * Static contract for the vendored FFmpeg skill.
 *
 * The checked-in `skills/ffmpeg/contract/contract.json` is the only schema the
 * host trusts. Argument names, CLI spellings, and which keys are positional
 * all come from it; this module does not keep a second flag table.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadAllSkills } from '@/shared/plugins';
import { findSkill, type LoadedSkill } from '@/shared/skills/loader';

import { FfmpegSkillError } from './errors';

export const CONTRACT_VERSION = '1.0';
export const EXPECTED_TOOL_COUNT = 42;

/** Repo payload, used only when the skill loader cannot see the skill. */
const REPO_SKILL_DIR = join(__dirname, '../../../../../skills/ffmpeg');

export interface ContractProperty {
  type: 'string' | 'boolean' | 'integer' | 'number' | 'array';
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: { type?: string };
  /** Accepted CLI spellings, or the literal "positional". */
  cli: string[] | 'positional';
  common?: boolean;
}

export interface ContractInputSchema {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, ContractProperty>;
  required: string[];
  positional: string[];
  mutually_exclusive?: string[][];
  one_of_required?: string[][];
}

export interface ContractTool {
  id: string;
  name: string;
  description: string;
  role: 'analysis' | 'analysis_and_execution' | 'execution' | 'verification';
  executable: string;
  produces_artifact: boolean;
  requires_visual_verification: boolean;
  input_schema: ContractInputSchema;
  mcp: {
    tool: string;
    positional: string[];
    argument_exceptions: Record<string, string>;
  };
}

export interface FfmpegSkillContract {
  contract_version: string;
  skill: { id: string; version: string };
  invocation: {
    structured: {
      argument_mapping: { json?: string };
    };
  };
  tools: ContractTool[];
}

export interface LoadedFfmpegContract {
  skillDir: string;
  payloadVersion: string;
  contract: FfmpegSkillContract;
  tools: Map<string, ContractTool>;
}

let cached: Promise<LoadedFfmpegContract> | null = null;
let cachedSkillDir: string | null = null;

/** Drop the cached contract. Tests use this after pointing at another skill. */
export function clearFfmpegContractCache(): void {
  cached = null;
  cachedSkillDir = null;
}

/**
 * Locate the vendored skill. The loader wins; the repository copy is only a
 * fallback for a checkout whose discovery roots do not include it yet.
 */
export async function resolveFfmpegSkillDir(): Promise<string> {
  const skills = await loadAllSkills({ watch: false });
  const found = findSkill(skills as LoadedSkill[], 'ffmpeg');
  if (found) return found.path;
  return REPO_SKILL_DIR;
}

export async function loadFfmpegContract(): Promise<LoadedFfmpegContract> {
  const skillDir = await resolveFfmpegSkillDir();
  if (cached && cachedSkillDir === skillDir) return cached;
  cachedSkillDir = skillDir;
  cached = readContract(skillDir);
  return cached;
}

async function readContract(skillDir: string): Promise<LoadedFfmpegContract> {
  const contractPath = join(skillDir, 'contract', 'contract.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(contractPath, 'utf8')) as unknown;
  } catch (error) {
    throw new FfmpegSkillError(
      'missing_runtime',
      `The FFmpeg skill contract could not be read at ${contractPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const contract = assertContract(parsed);
  return {
    skillDir,
    payloadVersion: contract.skill.version,
    contract,
    tools: new Map(contract.tools.map((tool) => [tool.name, tool])),
  };
}

function assertContract(value: unknown): FfmpegSkillContract {
  if (!isRecord(value)) {
    throw new FfmpegSkillError(
      'missing_runtime',
      'The FFmpeg skill contract is not a JSON object.',
    );
  }
  if (value.contract_version !== CONTRACT_VERSION) {
    throw new FfmpegSkillError(
      'missing_runtime',
      `The FFmpeg skill contract is version ${String(value.contract_version)}, expected ${CONTRACT_VERSION}.`,
    );
  }
  const skill = isRecord(value.skill) ? value.skill : null;
  if (
    !skill ||
    skill.id !== 'ffmpeg-skill' ||
    typeof skill.version !== 'string'
  ) {
    throw new FfmpegSkillError(
      'missing_runtime',
      'The FFmpeg skill contract is missing its ffmpeg-skill identity.',
    );
  }
  if (!Array.isArray(value.tools)) {
    throw new FfmpegSkillError(
      'missing_runtime',
      'The FFmpeg skill contract has no tool list.',
    );
  }
  if (value.tools.length !== EXPECTED_TOOL_COUNT) {
    throw new FfmpegSkillError(
      'missing_runtime',
      `The FFmpeg skill contract lists ${value.tools.length} tools, expected ${EXPECTED_TOOL_COUNT}.`,
    );
  }
  const tools = value.tools.map(assertTool);
  const names = new Set(tools.map((tool) => tool.name));
  if (names.size !== tools.length) {
    throw new FfmpegSkillError(
      'missing_runtime',
      'The FFmpeg skill contract repeats a tool name.',
    );
  }
  return value as unknown as FfmpegSkillContract;
}

function assertTool(value: unknown): ContractTool {
  if (!isRecord(value) || typeof value.name !== 'string') {
    throw new FfmpegSkillError(
      'missing_runtime',
      'A FFmpeg skill contract tool has no name.',
    );
  }
  const schema = isRecord(value.input_schema) ? value.input_schema : null;
  if (
    !schema ||
    schema.additionalProperties !== false ||
    !isRecord(schema.properties)
  ) {
    throw new FfmpegSkillError(
      'missing_runtime',
      `The ${value.name} tool schema is not a closed object.`,
    );
  }
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!isRecord(property) || !propertyHasCli(property.cli)) {
      throw new FfmpegSkillError(
        'missing_runtime',
        `The ${value.name}.${key} argument has no CLI spelling.`,
      );
    }
  }
  const mcp = isRecord(value.mcp) ? value.mcp : null;
  if (!mcp || !isRecord(mcp.argument_exceptions)) {
    throw new FfmpegSkillError(
      'missing_runtime',
      `The ${value.name} tool has no argument mapping.`,
    );
  }
  return value as unknown as ContractTool;
}

function propertyHasCli(cli: unknown): boolean {
  if (cli === 'positional') return true;
  return (
    Array.isArray(cli) &&
    cli.length > 0 &&
    cli.every((spelling) => typeof spelling === 'string' && spelling.length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Argument names the host accepts for one tool, in contract order. */
export function structuredArgumentNames(tool: ContractTool): string[] {
  return Object.keys(tool.input_schema.properties);
}

export interface CatalogEntry {
  name: string;
  id: string;
  role: ContractTool['role'];
  description: string;
  arguments: string[];
  producesArtifact: boolean;
}

/** The model-facing catalog. Schemas stay on the host. */
export function catalogEntries(contract: FfmpegSkillContract): CatalogEntry[] {
  return contract.tools.map((tool) => ({
    name: tool.name,
    id: tool.id,
    role: tool.role,
    description: tool.description,
    arguments: structuredArgumentNames(tool),
    producesArtifact: tool.produces_artifact,
  }));
}
