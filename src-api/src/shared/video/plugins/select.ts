import {
  computeVideoPluginRunGate,
  type VideoPluginGateOptions,
  type VideoPluginRunGate,
} from './runtime';
import type { VideoPlugin } from './types';

export interface VideoPluginSelectionOptions {
  query?: string;
  limit?: number;
}

export interface VideoPluginApplyOptions extends VideoPluginGateOptions {
  inputs?: Record<string, unknown>;
}

export interface VideoPluginSummary {
  id: string;
  name: string;
  title: string;
  version: string;
  description: string;
  sourceScope: string;
  trustTier: string;
  manifestDigest: string;
  engine: VideoPlugin['engine'];
  mode: string;
  kind: string;
  aspectRatios: string[];
  tags: string[];
  capabilities: string[];
  impliedCapabilities: string[];
  restricted: boolean;
  deniedCapabilities: string[];
  requiresReview: boolean;
  suggestedPrompt: string;
  score: number;
}

const DEFAULT_PLUGIN_QUERY = 'this project';
const DEFAULT_SELECTION_LIMIT = 12;
const MAX_SELECTION_LIMIT = 50;
const TOKEN_RE = /[a-z0-9]+/gi;
const TEMPLATE_TOKEN_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function selectVideoPlugins(
  plugins: readonly VideoPlugin[],
  options: VideoPluginSelectionOptions = {},
): VideoPluginSummary[] {
  const query = options.query?.trim() ?? '';
  const limit = normalizeLimit(options.limit);
  const scored = plugins.map((plugin) =>
    summarizeVideoPlugin(plugin, {
      query,
      score: scoreVideoPlugin(plugin, query),
    }),
  );
  const candidates = query
    ? scored.filter((plugin) => plugin.score > 0)
    : scored;

  return candidates
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.title.localeCompare(b.title);
    })
    .slice(0, limit);
}

export function summarizeVideoPlugin(
  plugin: VideoPlugin,
  options: {
    query?: string;
    inputs?: Record<string, unknown>;
    gate?: VideoPluginRunGate;
    score?: number;
  } = {},
): VideoPluginSummary {
  const gate =
    options.gate ??
    computeVideoPluginRunGate(plugin, {
      inputs: options.inputs,
    });
  const requiresReview = gate.grants.some(
    (grant) => !grant.granted && grant.requiresExplicitApproval,
  );

  return {
    id: plugin.id,
    name: plugin.name,
    title: plugin.title,
    version: plugin.version,
    description: plugin.description,
    sourceScope: plugin.sourceScope,
    trustTier: plugin.trustTier,
    manifestDigest: plugin.manifestDigest,
    engine: plugin.engine,
    mode: plugin.manifest.video.mode,
    kind: plugin.manifest.video.kind,
    aspectRatios: [...plugin.manifest.video.aspectRatios],
    tags: plugin.manifest.tags ? [...plugin.manifest.tags] : [],
    capabilities: [...plugin.capabilities],
    impliedCapabilities: [...plugin.impliedCapabilities],
    restricted: gate.restricted,
    deniedCapabilities: [...gate.deniedCapabilities],
    requiresReview,
    suggestedPrompt: hydrateVideoPluginUseCaseQuery(plugin, {
      ...inputDefaultsForPlugin(plugin),
      ...options.inputs,
      ...(options.query ? { topic: options.query } : {}),
    }),
    score: options.score ?? 0,
  };
}

export function applyVideoPlugin(
  plugin: VideoPlugin,
  options: VideoPluginApplyOptions = {},
): {
  prompt: string;
  gate: VideoPluginRunGate;
  summary: VideoPluginSummary;
  context: {
    pluginId: string;
    pluginInputs: Record<string, unknown>;
    approvedPluginCapabilities: string[];
    lastReviewedPluginDigest: string | null;
    pluginSignatureOk: boolean | null;
  };
} {
  const inputs = {
    ...inputDefaultsForPlugin(plugin),
    ...(options.inputs ?? {}),
  };
  const gate = computeVideoPluginRunGate(plugin, {
    inputs,
    output: options.output,
    approvedCapabilities: options.approvedCapabilities,
    lastReviewedDigest: options.lastReviewedDigest,
    signatureOk: options.signatureOk,
  });
  const prompt = hydrateVideoPluginUseCaseQuery(plugin, inputs);

  return {
    prompt,
    gate,
    summary: summarizeVideoPlugin(plugin, {
      inputs,
      gate,
    }),
    context: {
      pluginId: plugin.id,
      pluginInputs: inputs,
      approvedPluginCapabilities: normalizeStrings(
        options.approvedCapabilities ?? [],
      ),
      lastReviewedPluginDigest: options.lastReviewedDigest ?? null,
      pluginSignatureOk: options.signatureOk ?? null,
    },
  };
}

export function hydrateVideoPluginUseCaseQuery(
  plugin: VideoPlugin,
  inputs: Record<string, unknown> = {},
): string {
  const template =
    plugin.manifest.video.useCase?.query ??
    `Use ${plugin.title} for ${DEFAULT_PLUGIN_QUERY}.`;
  return template.replace(TEMPLATE_TOKEN_RE, (_match, key: string) => {
    const value = inputs[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (key === 'topic') return DEFAULT_PLUGIN_QUERY;
    return DEFAULT_PLUGIN_QUERY;
  });
}

export function scoreVideoPlugin(plugin: VideoPlugin, query: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const weightedFields: Array<[string, number]> = [
    [plugin.id, 12],
    [plugin.name, 12],
    [plugin.title, 10],
    [plugin.manifest.video.mode, 8],
    [plugin.manifest.video.kind, 4],
    [plugin.description, 4],
    [plugin.manifest.video.useCase?.query ?? '', 4],
    [(plugin.manifest.tags ?? []).join(' '), 8],
    [plugin.manifest.video.useCase?.activation?.keywords?.join(' ') ?? '', 12],
    [plugin.manifest.video.useCase?.goals?.join(' ') ?? '', 2],
  ];

  return weightedFields.reduce(
    (score, [field, weight]) =>
      score + countTokenMatches(tokenize(field), queryTokens) * weight,
    0,
  );
}

function inputDefaultsForPlugin(plugin: VideoPlugin): Record<string, unknown> {
  const inputs: Record<string, unknown> = { topic: DEFAULT_PLUGIN_QUERY };
  for (const input of plugin.manifest.video.inputs ?? []) {
    if (input.default !== undefined) {
      inputs[input.key] = input.default;
    }
  }
  return inputs;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_SELECTION_LIMIT;
  }
  return Math.min(MAX_SELECTION_LIMIT, Math.max(1, Math.floor(value)));
}

function normalizeStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))];
}

function tokenize(value: string): string[] {
  return (value.match(TOKEN_RE) ?? []).map((token) => token.toLowerCase());
}

function countTokenMatches(
  fieldTokens: readonly string[],
  queryTokens: string[],
) {
  if (fieldTokens.length === 0) return 0;
  const field = new Set(fieldTokens);
  return queryTokens.reduce(
    (count, token) => count + (field.has(token) ? 1 : 0),
    0,
  );
}
