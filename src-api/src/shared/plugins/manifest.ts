/**
 * Plugin Manifest Schema
 *
 * Zod-validated schema for `.claude-plugin/plugin.json` (and the
 * codex/cursor variants). Wire-compatible with Anthropic's spec so plugins
 * from anthropics/claude-plugins-official load without conversion.
 *
 * Neuma-specific extensions live under `metadata.neuma` to stay
 * forward-compatible with upstream.
 */

import fs from 'fs/promises';
import { join } from 'path';

import { z } from 'zod';

import {
  adaptOpenDesignManifest,
  isOpenDesignManifest,
} from './adapters/open-design';

/** Lower-kebab-case namespace token used in `pluginName:skillName`. */
export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Strict semver 2.0 regex (subset — full grammar enforced at install time). */
export const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/;

const AuthorObject = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  url: z.string().url().optional(),
});

const RepositoryObject = z.object({
  type: z.string().min(1),
  url: z.string().url(),
});

const SignatureObject = z.object({
  algorithm: z.literal('ed25519'),
  publicKeyId: z.string().min(1).max(128),
  signature: z.string().min(1),
});

const PluginSurface = z.enum(['task', 'design', 'video', 'chat']);

const RelativePluginPath = z
  .string()
  .min(1)
  .max(300)
  .refine(
    (value) =>
      !value.includes('\0') &&
      !value.startsWith('/') &&
      !/^[a-zA-Z]:[\\/]/.test(value) &&
      !/(^|[\\/])\.\.([\\/]|$)/.test(value),
    'path must be plugin-relative and stay within the plugin folder',
  );

const ConfigOptionObject = z.object({
  label: z.string().min(1).max(120),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const PluginConfigField = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_.-]*$/,
      'config field key must start with a letter or underscore',
    ),
  type: z.enum(['string', 'number', 'boolean', 'secret', 'enum']),
  label: z.string().min(1).max(120).optional(),
  help: z.string().min(1).max(300).optional(),
  sensitive: z.boolean().optional(),
  advanced: z.boolean().optional(),
  order: z.number().int().optional(),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(ConfigOptionObject).max(50).optional(),
  uiHints: z.record(z.string(), z.unknown()).optional(),
});

const NeumaMetadata = z
  .object({
    minHostVersion: z.string().optional(),
    surfaces: z.array(PluginSurface).max(4).optional(),
    videoManifest: RelativePluginPath.optional(),
    designManifest: RelativePluginPath.optional(),
    taskManifest: RelativePluginPath.optional(),
    /**
     * Explicit skill directories (each containing a SKILL.md), in addition to
     * the `skills/` scan. Populated by the Open Design adapter for plugins
     * that declare `compat.agentSkills[]` with root-level SKILL.md files.
     */
    skillFiles: z.array(RelativePluginPath).max(50).optional(),
    /**
     * Short list of capability grants the plugin requests when applied
     * (e.g. `prompt:inject`). Surfaced in the detail view as "permissions".
     */
    capabilitiesSummary: z.array(z.string().min(1).max(100)).max(50).optional(),
    /**
     * Example prompt seeded into the composer when the plugin is applied via
     * "Use". Adapted from Open Design's `od.useCase.query`.
     */
    exampleQuery: z.string().min(1).max(4000).optional(),
    /**
     * Concrete refs the plugin pulls in at apply time — rendered as "Context
     * Bundles". Adapted from Open Design's `od.context`.
     */
    contextBundles: z
      .object({
        skills: z.array(z.string().min(1).max(300)).max(50).optional(),
        assets: z.array(z.string().min(1).max(300)).max(50).optional(),
        mcpServers: z.array(z.string().min(1).max(300)).max(50).optional(),
        designSystems: z.array(z.string().min(1).max(300)).max(50).optional(),
      })
      .optional(),
    /** Raw Open Design classifiers, preserved for the installed detail view. */
    openDesign: z
      .object({
        kind: z.string().max(100).optional(),
        taskKind: z.string().max(100).optional(),
        mode: z.string().max(100).optional(),
        scenario: z.string().max(100).optional(),
        platform: z.string().max(100).optional(),
      })
      .passthrough()
      .optional(),
    requires: z
      .object({
        anyBins: z.array(z.string().min(1)).max(20).optional(),
        envVars: z.array(z.string().min(1)).max(20).optional(),
      })
      .optional(),
    signature: SignatureObject.optional(),
    configSchema: z.array(PluginConfigField).max(100).optional(),
  })
  .passthrough()
  .optional();

/**
 * Strict schema. We use `.strict()` on the outer object so unknown top-level
 * keys are rejected — this catches typos in community manifests early — but
 * `metadata` is `.passthrough()` so vendors can add their own namespaces.
 */
export const PluginManifestSchema = z
  .object({
    $schema: z.string().url().optional(),

    // Identity
    name: z
      .string()
      .regex(PLUGIN_NAME_RE, 'name must be lower-kebab-case (a-z, 0-9, -)'),
    // Version is optional per the Claude Code spec (it falls back to the git
    // SHA upstream). Many marketplace plugins omit it; default to 0.0.0 so the
    // install substrate always has a value. A present-but-malformed version is
    // still rejected.
    version: z
      .string()
      .regex(SEMVER_RE, 'version must be valid semver 2.0')
      .optional()
      .default('0.0.0'),
    // Matches the marketplace schema cap (2000). Real plugins — Open Design's
    // especially — ship long descriptions; a lower cap here rejected them.
    description: z.string().min(1).max(2000),

    // Optional descriptive fields
    displayName: z.string().min(1).max(200).optional(),
    author: z.union([z.string().min(1).max(200), AuthorObject]).optional(),
    homepage: z.string().url().optional(),
    repository: z.union([z.string().url(), RepositoryObject]).optional(),
    license: z.string().min(1).max(100).optional(),
    keywords: z.array(z.string().min(1).max(50)).max(20).optional(),

    // Component roots (relative to plugin dir)
    skills: z.string().default('skills'),
    commands: z.string().optional(),
    agents: z.string().optional(),
    hooks: z.string().optional(),
    mcp: z.string().optional(),

    // Vendor-namespaced extensions. metadata.neuma is the only sub-key we own;
    // .passthrough() is intentional — Anthropic's spec lets vendors add their
    // own namespaces here (e.g. metadata.openclaw, metadata.cursor) and we
    // store the full object verbatim so the UI can surface it. Mass-assignment
    // is not a risk because metadata is only ever read back as JSON, never
    // unpacked into typed columns.
    metadata: z
      .object({
        neuma: NeumaMetadata,
      })
      .passthrough()
      .optional(),
  })
  .strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginConfigField = z.infer<typeof PluginConfigField>;

export interface ManifestParseResult {
  ok: boolean;
  manifest?: PluginManifest;
  /** Flat list of human-readable issues (one per failed Zod check). */
  issues: string[];
}

/**
 * Parse a JSON string against {@link PluginManifestSchema}.
 *
 * Never throws — returns an issue list on any failure (parse error, schema
 * error, both). Callers should treat `ok: false` as "do not load this
 * plugin" and surface `issues` in logs / UI.
 */
/** Flatten Zod issues into `<path>: <message>` strings for logs and API replies. */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (i) => `${i.path.join('.') || '<root>'}: ${i.message}`,
  );
}

export function parseManifest(jsonText: string): ManifestParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    return {
      ok: false,
      issues: [`Invalid JSON: ${(err as Error).message}`],
    };
  }
  // Normalize Open Design manifests into the Neuma shape before validation so
  // an `open-design.json` plugin loads like a native one.
  if (isOpenDesignManifest(raw)) {
    raw = adaptOpenDesignManifest(raw as Record<string, unknown>);
  }
  const result = PluginManifestSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, issues: formatZodIssues(result.error) };
  }
  return { ok: true, manifest: result.data, issues: [] };
}

/**
 * Manifest filenames probed per plugin, in priority order. The Claude / Codex
 * / Cursor variants are wire-compatible; `open-design.json` is normalized by
 * the Open Design adapter at parse time.
 */
export const MANIFEST_FILENAMES = [
  '.claude-plugin/plugin.json',
  '.codex-plugin/plugin.json',
  '.cursor-plugin/plugin.json',
  'open-design.json',
] as const;

/**
 * Probe each `MANIFEST_FILENAMES` variant under `pluginDir` and return the
 * first one that exists. Returns null if none do.
 */
export async function readManifestFile(
  pluginDir: string,
): Promise<{ raw: string; path: string } | null> {
  for (const rel of MANIFEST_FILENAMES) {
    const path = join(pluginDir, rel);
    try {
      const raw = await fs.readFile(path, 'utf-8');
      return { raw, path };
    } catch {
      // try next variant
    }
  }
  return null;
}
