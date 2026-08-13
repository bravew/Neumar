import {
  computeCapabilityGrants,
  createAppliedSnapshot,
  filterAllowedToolsByCapabilities,
  toAppliedSnapshotConfig,
  type AppliedSnapshot,
  type CapabilityGrant,
  type PluginRuntimeConfig,
} from '@/shared/plugins/runtime';

import {
  registerVideoPluginCapabilities,
  VIDEO_PLUGIN_CAPABILITIES,
  type VideoPlugin,
  type VideoPluginCapability,
  type VideoPluginSnapshotPayload,
} from './types';

export interface VideoPluginGateOptions {
  inputs?: Record<string, unknown>;
  output?: Record<string, unknown>;
  approvedCapabilities?: readonly string[];
  lastReviewedDigest?: string | null;
  signatureOk?: boolean | null;
}

export interface VideoPluginPromptContext {
  id: string;
  title: string;
  version: string;
  promptGuide: string;
  stageChecklist: string[];
  config?: {
    publicValues: Record<string, string | number | boolean>;
    sensitiveKeys: string[];
  };
}

export interface VideoPluginRunGate {
  plugin: VideoPlugin;
  requestedCapabilities: VideoPluginCapability[];
  grants: CapabilityGrant[];
  grantedCapabilities: VideoPluginCapability[];
  deniedCapabilities: VideoPluginCapability[];
  restricted: boolean;
  config?: PluginRuntimeConfig;
  promptContext?: VideoPluginPromptContext;
}

export interface VideoPluginToolGroup {
  serverName: string;
  tools: readonly NamedMcpToolDefinition[];
}

export interface NamedMcpToolDefinition {
  name: string;
}

export interface CreateVideoPluginRunSnapshotOptions {
  inputs?: Record<string, unknown>;
  output?: Record<string, unknown>;
  allowedTools?: readonly string[];
  enabledMcpServers?: readonly string[];
  createdAt?: string;
}

const VIDEO_PLUGIN_CAPABILITY_SET = new Set<string>(VIDEO_PLUGIN_CAPABILITIES);

const RESTRICTED_DENIED_CAPABILITIES = new Set<VideoPluginCapability>([
  'prompt:inject',
  'research:web',
  'network:stock',
  'network:music',
  'network:map',
  'network:geocode',
  'network:weather',
  'media:generate',
  'media:vision',
  'media:transcribe',
  'video:analyze',
  'video:edit',
  'network:youtube',
]);

export function computeVideoPluginRunGate(
  plugin: VideoPlugin,
  options: VideoPluginGateOptions = {},
): VideoPluginRunGate {
  registerVideoPluginCapabilities();
  const approvedCapabilities = normalizeVideoPluginCapabilities(
    options.approvedCapabilities ?? [],
  );
  const requestedCapabilities = requestedCapabilitiesForRun(
    plugin,
    approvedCapabilities,
  );
  const restricted = isRestrictedVideoPluginRun(plugin, options);
  const rawGrants = computeCapabilityGrants({
    requested: requestedCapabilities,
    trustTier: plugin.trustTier,
    manifestDigest: plugin.manifestDigest,
    lastReviewedDigest: options.lastReviewedDigest,
    signatureOk: options.signatureOk,
    approvedCapabilities,
  });
  const grants = restricted
    ? suppressRestrictedVideoCapabilities(rawGrants)
    : rawGrants;
  const grantedCapabilities = grants.flatMap((grant) =>
    grant.granted && isVideoPluginCapability(grant.capability)
      ? [grant.capability]
      : [],
  );
  const deniedCapabilities = grants.flatMap((grant) =>
    !grant.granted && isVideoPluginCapability(grant.capability)
      ? [grant.capability]
      : [],
  );
  const promptContext = isCapabilityGranted(grants, 'prompt:inject')
    ? buildVideoPluginPromptContext(plugin)
    : undefined;

  return {
    plugin,
    requestedCapabilities,
    grants,
    grantedCapabilities,
    deniedCapabilities,
    restricted,
    config: plugin.config,
    promptContext,
  };
}

export function createVideoPluginRunSnapshot(
  gate: VideoPluginRunGate,
  options: CreateVideoPluginRunSnapshotOptions = {},
): AppliedSnapshot<VideoPluginSnapshotPayload> {
  const payload: VideoPluginSnapshotPayload = {
    engine: gate.plugin.engine,
    stages: gate.plugin.stages,
    inputs: options.inputs ?? {},
    output: options.output ?? {},
    templates: gate.plugin.templates,
    grants: gate.grants,
    deniedCapabilities: gate.deniedCapabilities,
    restricted: gate.restricted,
    promptGuideIncluded: Boolean(gate.promptContext),
    allowedTools: options.allowedTools ? [...options.allowedTools] : [],
    enabledMcpServers: options.enabledMcpServers
      ? [...options.enabledMcpServers]
      : [],
    networkPolicy: gate.plugin.networkPolicy,
  };

  return createAppliedSnapshot({
    domain: 'video',
    plugin: {
      id: gate.plugin.id,
      name: gate.plugin.name,
      version: gate.plugin.version,
      source: gate.plugin.sourceScope,
      trustTier: gate.plugin.trustTier,
      manifestDigest: gate.plugin.manifestDigest,
    },
    capabilities: gate.grantedCapabilities,
    config: toAppliedSnapshotConfig(gate.config),
    payload,
    createdAt: options.createdAt,
  });
}

export function buildExactAllowedToolsForVideoPluginRun(
  toolGroups: readonly VideoPluginToolGroup[],
  gate: VideoPluginRunGate,
  extraToolNames: readonly string[] = [],
): string[] {
  const exactNames = [
    ...toolGroups.flatMap((group) =>
      group.tools.map((toolDefinition) =>
        mcpToolFullName(group.serverName, toolDefinition.name),
      ),
    ),
    ...extraToolNames,
  ];
  return filterAllowedToolsByCapabilities(uniquePreservingOrder(exactNames), [
    ...gate.grants,
  ]);
}

export function filterMcpToolDefinitionsForVideoPluginRun<
  TTool extends NamedMcpToolDefinition,
>(
  serverName: string,
  tools: readonly TTool[],
  gate: VideoPluginRunGate,
): TTool[] {
  const allowed = new Set(
    filterAllowedToolsByCapabilities(
      tools.map((toolDefinition) =>
        mcpToolFullName(serverName, toolDefinition.name),
      ),
      gate.grants,
    ),
  );
  return tools.filter((toolDefinition) =>
    allowed.has(mcpToolFullName(serverName, toolDefinition.name)),
  );
}

export function mcpToolFullName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

export function isVideoPluginCapability(
  capability: string,
): capability is VideoPluginCapability {
  return VIDEO_PLUGIN_CAPABILITY_SET.has(capability);
}

function requestedCapabilitiesForRun(
  plugin: VideoPlugin,
  approvedCapabilities: readonly VideoPluginCapability[],
): VideoPluginCapability[] {
  const declared = new Set(plugin.capabilities);
  const requested = new Set<VideoPluginCapability>(declared);
  for (const capability of approvedCapabilities) {
    if (declared.has(capability)) {
      requested.add(capability);
    }
  }
  return [...requested].sort();
}

function normalizeVideoPluginCapabilities(
  capabilities: readonly string[],
): VideoPluginCapability[] {
  const normalized = capabilities.filter(
    (capability): capability is VideoPluginCapability =>
      isVideoPluginCapability(capability),
  );
  return uniquePreservingOrder(normalized);
}

function isRestrictedVideoPluginRun(
  plugin: VideoPlugin,
  options: VideoPluginGateOptions,
): boolean {
  if (options.signatureOk === false) return true;
  if (plugin.trustTier === 'bundled' || plugin.trustTier === 'saved') {
    return false;
  }
  return !(
    Boolean(plugin.manifestDigest) &&
    plugin.manifestDigest === options.lastReviewedDigest
  );
}

function suppressRestrictedVideoCapabilities(
  grants: readonly CapabilityGrant[],
): CapabilityGrant[] {
  return grants.map((grant) => {
    if (
      isVideoPluginCapability(grant.capability) &&
      RESTRICTED_DENIED_CAPABILITIES.has(grant.capability)
    ) {
      return {
        ...grant,
        granted: false,
        reason:
          'Restricted plugin run: review the current manifest digest before this capability can be used',
        requiresExplicitApproval: true,
      };
    }
    return grant;
  });
}

function isCapabilityGranted(
  grants: readonly CapabilityGrant[],
  capability: VideoPluginCapability,
): boolean {
  return grants.some(
    (grant) => grant.capability === capability && grant.granted,
  );
}

function buildVideoPluginPromptContext(
  plugin: VideoPlugin,
): VideoPluginPromptContext {
  return {
    id: plugin.id,
    title: plugin.title,
    version: plugin.version,
    promptGuide: plugin.promptGuide,
    stageChecklist: plugin.stages.map((stage) => {
      const flags = [
        stage.optional ? 'optional' : 'required',
        stage.repeat ? `repeat until ${stage.until ?? 'condition is met'}` : '',
      ].filter(Boolean);
      return `${stage.id}: ${stage.atoms.join(', ')} (${flags.join(', ')})`;
    }),
    ...(plugin.config && plugin.config.keys.length > 0
      ? {
          config: {
            publicValues: plugin.config.publicValues,
            sensitiveKeys: plugin.config.sensitiveKeys,
          },
        }
      : {}),
  };
}

function uniquePreservingOrder<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
