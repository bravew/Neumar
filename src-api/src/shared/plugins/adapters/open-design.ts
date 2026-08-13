/**
 * Open Design compatibility adapter.
 *
 * Open Design plugins ship an `open-design.json` sidecar (with an `od`
 * metadata block and a `compat.agentSkills[]` list pointing at SKILL.md files)
 * and publish catalogs in the `open-design-marketplace.v1` format. Both differ
 * from the Anthropic wire format Neuma standardizes on.
 *
 * Rather than fork the plugin substrate, we normalize Open Design documents
 * into Neuma's shapes at the boundary — the manifest parser and the registry
 * fetcher — so an Open Design plugin loads, installs, and appears in the
 * marketplace exactly like a native one. Neuma-specific behavior derived from
 * `od` (surfaces, skill files) lands under `metadata.neuma`.
 *
 * Reference: `_sample/open-design/plugins/spec/SPEC.md`.
 */

import { dirname } from 'path';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** Clamp a string to the manifest field cap so verbose docs still validate. */
function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Extract the English (or first available) example prompt from an Open Design
 * `od.useCase.query` block, which is a locale map: `{ en, "zh-CN", … }`.
 */
function exampleQueryFromUseCase(
  od: Record<string, unknown>,
): string | undefined {
  const useCase = isRecord(od.useCase) ? od.useCase : undefined;
  const query = useCase && isRecord(useCase.query) ? useCase.query : undefined;
  if (!query) return undefined;
  return str(query.en) ?? str(Object.values(query).find((v) => str(v)));
}

/** Collect the string paths from an `od.context.<key>` list of paths/objects. */
function contextPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const path = isRecord(entry) ? str(entry.path) : str(entry);
    if (path) out.push(path);
  }
  return out;
}

/** Adapt an Open Design `od.context` block into Neuma's contextBundles shape. */
function contextBundlesFromOd(
  od: Record<string, unknown>,
): Record<string, string[]> | undefined {
  const context = isRecord(od.context) ? od.context : undefined;
  if (!context) return undefined;
  const bundles: Record<string, string[]> = {};
  const skills = contextPaths(context.skills);
  const assets = contextPaths(context.assets);
  const mcpServers = contextPaths(context.mcpServers);
  const designSystems = contextPaths(context.designSystems);
  if (skills.length) bundles.skills = skills;
  if (assets.length) bundles.assets = assets;
  if (mcpServers.length) bundles.mcpServers = mcpServers;
  if (designSystems.length) bundles.designSystems = designSystems;
  return Object.keys(bundles).length > 0 ? bundles : undefined;
}

// ---------------------------------------------------------------------------
// Manifest adapter
// ---------------------------------------------------------------------------

/** Detect an Open Design plugin manifest (`open-design.json`). */
export function isOpenDesignManifest(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const schema = str(raw.$schema) ?? '';
  if (schema.includes('open-design.ai/schemas/plugin')) return true;
  // An `od` block plus a `compat.agentSkills` list is the distinguishing shape.
  return isRecord(raw.od) || isRecord(raw.compat);
}

/** Map an Open Design `od.mode` to Neuma surfaces. */
function surfacesForMode(mode: string | undefined): string[] {
  if (mode === 'video' || mode === 'hyperframes' || mode === 'audio') {
    return ['video'];
  }
  // prototype, deck, live-artifact, image, design-system, import, extract,
  // critique, export, … are all design-surface workflows.
  return ['design'];
}

/**
 * Convert an Open Design manifest into a Neuma manifest object (pre-validation).
 * `metadata.neuma.skillFiles` carries the directories of each declared
 * SKILL.md so the loader can pick them up even when they sit at the plugin
 * root rather than under `skills/`.
 */
export function adaptOpenDesignManifest(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const od = isRecord(raw.od) ? raw.od : {};
  const compat = isRecord(raw.compat) ? raw.compat : {};
  const agentSkills = Array.isArray(compat.agentSkills)
    ? compat.agentSkills
    : [];

  const skillDirs = new Set<string>();
  for (const entry of agentSkills) {
    const path = isRecord(entry) ? str(entry.path) : str(entry);
    if (!path) continue;
    const dir = dirname(path).replace(/^\.$/, '.');
    skillDirs.add(dir === '' ? '.' : dir);
  }

  const author =
    isRecord(raw.author) && str(raw.author.name)
      ? { name: str(raw.author.name)!, url: str(raw.author.url) }
      : str(raw.author);

  const capabilities = Array.isArray(od.capabilities)
    ? od.capabilities.filter((c): c is string => typeof c === 'string')
    : undefined;

  const exampleQuery = exampleQueryFromUseCase(od);
  const contextBundles = contextBundlesFromOd(od);

  const manifest: Record<string, unknown> = {
    name: str(raw.name) ?? 'open-design-plugin',
    version: str(raw.version),
    description: clamp(
      str(raw.description) ?? str(raw.title) ?? 'Open Design plugin',
      2000,
    ),
    ...(str(raw.title) ? { displayName: str(raw.title) } : {}),
    ...(author ? { author } : {}),
    ...(str(raw.homepage) ? { homepage: str(raw.homepage) } : {}),
    ...(str(raw.license) ? { license: str(raw.license) } : {}),
    ...(Array.isArray(raw.tags)
      ? {
          keywords: (raw.tags as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .slice(0, 20),
        }
      : {}),
    metadata: {
      neuma: {
        surfaces: surfacesForMode(str(od.mode)),
        ...(skillDirs.size > 0 ? { skillFiles: [...skillDirs] } : {}),
        ...(capabilities && capabilities.length > 0
          ? { capabilitiesSummary: capabilities }
          : {}),
        ...(exampleQuery ? { exampleQuery: clamp(exampleQuery, 4000) } : {}),
        ...(contextBundles ? { contextBundles } : {}),
        openDesign: {
          ...(str(od.kind) ? { kind: str(od.kind) } : {}),
          ...(str(od.taskKind) ? { taskKind: str(od.taskKind) } : {}),
          ...(str(od.mode) ? { mode: str(od.mode) } : {}),
          ...(str(od.scenario) ? { scenario: str(od.scenario) } : {}),
          ...(str(od.platform) ? { platform: str(od.platform) } : {}),
        },
      },
    },
  };
  return manifest;
}

// ---------------------------------------------------------------------------
// Marketplace catalog adapter
// ---------------------------------------------------------------------------

/** Detect an Open Design marketplace catalog document. */
export function isOpenDesignMarketplace(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  const schema = str(raw.$schema) ?? '';
  if (schema.includes('open-design.ai/schemas/marketplace')) return true;
  // Open Design catalogs carry `specVersion` + `trust` at the top level;
  // native Anthropic catalogs carry neither.
  return 'specVersion' in raw && 'trust' in raw;
}

/**
 * Parse an Open Design plugin source string
 * (`github:owner/repo[@ref][/subdir…]`) into Neuma's github object source.
 * Unlike Neuma's `owner/repo@ref#subdir`, Open Design appends the subdir to
 * the ref with a `/`.
 */
export function parseOpenDesignSource(
  source: string,
): Record<string, unknown> | string {
  const trimmed = source.trim();
  if (!trimmed.startsWith('github:')) return trimmed;
  const body = trimmed.slice('github:'.length);
  const atIndex = body.indexOf('@');
  const repoPart = atIndex >= 0 ? body.slice(0, atIndex) : body;
  const [owner, repo] = repoPart.split('/');
  if (!owner || !repo) return trimmed;

  let ref: string | undefined;
  let path: string | undefined;
  if (atIndex >= 0) {
    const rest = body.slice(atIndex + 1);
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      ref = rest.slice(0, slash);
      path = rest.slice(slash + 1);
    } else {
      ref = rest;
    }
  }
  return {
    source: 'github',
    repo: `${owner}/${repo.replace(/\.git$/, '')}`,
    ...(ref ? { ref } : {}),
    ...(path ? { path } : {}),
  };
}

/**
 * Convert an Open Design catalog into a Neuma marketplace object
 * (pre-validation). Entry titles become display names, capability summaries
 * and mode-derived surfaces move under `metadata.neuma`, and each github
 * source string is normalized to the object form.
 */
export function adaptOpenDesignMarketplace(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const plugins = Array.isArray(raw.plugins) ? raw.plugins : [];
  const adaptedPlugins = plugins
    .filter(isRecord)
    .map((entry) => {
      const name = str(entry.name);
      const description = str(entry.description) ?? str(entry.title);
      const source = entry.source;
      if (!name || !description || source === undefined) return null;

      const capabilities = Array.isArray(entry.capabilitiesSummary)
        ? entry.capabilitiesSummary.filter(
            (c): c is string => typeof c === 'string',
          )
        : undefined;

      // Open Design entries carry a `publisher: { id, url }`; surface it as the
      // Neuma `author` (publisher) field.
      const publisher = isRecord(entry.publisher) ? entry.publisher : null;
      const author =
        publisher && (str(publisher.id) || str(publisher.name))
          ? {
              name: (str(publisher.id) || str(publisher.name))!,
              ...(str(publisher.url) ? { url: str(publisher.url) } : {}),
            }
          : undefined;

      return {
        name,
        description: clamp(description, 2000),
        source:
          typeof source === 'string' ? parseOpenDesignSource(source) : source,
        ...(str(entry.version) ? { version: str(entry.version) } : {}),
        ...(str(entry.title) ? { displayName: str(entry.title) } : {}),
        ...(author ? { author } : {}),
        ...(str(entry.homepage) ? { homepage: str(entry.homepage) } : {}),
        ...(str(entry.license) ? { license: str(entry.license) } : {}),
        ...(Array.isArray(entry.tags) ? { tags: entry.tags } : {}),
        metadata: {
          neuma: {
            surfaces: surfacesForMode(str(entry.mode)),
            ...(capabilities && capabilities.length > 0
              ? { capabilitiesSummary: capabilities }
              : {}),
          },
        },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  const owner =
    isRecord(raw.owner) && str(raw.owner.name)
      ? { name: str(raw.owner.name)!, url: str(raw.owner.url) }
      : { name: str(raw.name) ?? 'Open Design' };

  return {
    name: str(raw.name) ?? 'open-design',
    owner,
    metadata: {
      description: str(isRecord(raw.metadata) ? raw.metadata.description : ''),
      version: str(raw.version),
      adaptedFrom: 'open-design-marketplace.v1',
    },
    plugins: adaptedPlugins,
  };
}
