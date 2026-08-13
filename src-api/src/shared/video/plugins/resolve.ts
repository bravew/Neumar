import type { LoadedPlugin } from '@/shared/plugins';
import {
  type TrustTier,
  computeManifestDigest,
  deriveTrustTierFromScope,
  type PluginRuntimeConfig,
} from '@/shared/plugins/runtime';
import type { EngineTemplateRef } from '@/shared/video/engines/types';

import { compileVideoPluginNetworkPolicy } from './network-policy';
import {
  registerVideoPluginCapabilities,
  requiredCapabilitiesForAtoms,
  type VideoPlugin,
  type VideoPluginCapability,
  type VideoPluginStage,
} from './types';
import type { VideoPluginManifest } from './validate';

export interface ResolveVideoPluginInput {
  manifest: VideoPluginManifest;
  rootDir: string;
  manifestPath: string;
  substratePlugin: LoadedPlugin;
  trustTier?: TrustTier;
  config?: PluginRuntimeConfig;
}

export function resolveVideoPlugin(
  input: ResolveVideoPluginInput,
): VideoPlugin {
  registerVideoPluginCapabilities();
  const stages = input.manifest.video.pipeline.stages.map((stage) => ({
    id: stage.id,
    atoms: [...stage.atoms],
    optional: stage.optional ?? false,
    repeat: stage.repeat ?? false,
    until: stage.until,
    policy: stage.policy,
    inputs: stage.inputs,
  })) satisfies VideoPluginStage[];

  const impliedCapabilities = requiredCapabilitiesForAtoms(
    stages.flatMap((stage) => stage.atoms),
  );
  const capabilities = sortedCapabilities([
    ...input.manifest.video.capabilities,
    ...impliedCapabilities,
  ]);
  const compiledNetwork = compileVideoPluginNetworkPolicy(input.manifest);
  const version = input.substratePlugin.manifest.version;

  return {
    id: input.substratePlugin.manifest.name,
    name: input.manifest.name,
    title: input.manifest.title,
    version,
    description: input.manifest.description,
    rootDir: input.rootDir,
    manifestPath: input.manifestPath,
    sourceScope: input.substratePlugin.scope,
    trustTier:
      input.trustTier ?? deriveTrustTierFromScope(input.substratePlugin.scope),
    manifestDigest: computeManifestDigest(input.manifest),
    manifest: input.manifest,
    engine: {
      id: input.manifest.video.engine.id,
      ...(input.manifest.video.engine.templateRef
        ? {
            templateRef: input.manifest.video.engine
              .templateRef as EngineTemplateRef,
          }
        : {}),
    },
    stages,
    capabilities,
    impliedCapabilities,
    networkPolicy: compiledNetwork.policy,
    genuiSurfaces: input.manifest.video.genui?.surfaces ?? [],
    templates:
      input.manifest.video.templates?.map((template) => ({
        id: template.id,
        role: template.role,
      })) ?? [],
    config: input.config,
    promptGuide: buildPipelinePromptGuide(input.manifest, stages),
    diagnostics: [],
  };
}

function sortedCapabilities(
  capabilities: readonly VideoPluginCapability[],
): VideoPluginCapability[] {
  return Array.from(new Set(capabilities)).sort();
}

function buildPipelinePromptGuide(
  manifest: VideoPluginManifest,
  stages: readonly VideoPluginStage[],
): string {
  return [
    `## Active Video Plugin: ${manifest.title}`,
    manifest.description,
    'Run the plugin pipeline in order. Do not skip a non-optional stage unless a tool is unavailable and you explain the fallback.',
    ...stages.map((stage, index) => {
      const repeat = stage.repeat
        ? ` Repeat until ${stage.until ?? 'the stop condition is met'}.`
        : '';
      return `${index + 1}. ${stage.id}: ${stage.atoms.join(', ')}.${repeat}`;
    }),
  ].join('\n');
}
