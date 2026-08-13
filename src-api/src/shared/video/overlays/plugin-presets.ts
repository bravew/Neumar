import {
  VIVID_OVERLAY_LOTTIE_ASSETS,
  vividOverlayDocument,
  type VividOverlayControlDef,
  type VividOverlayPresetDef,
} from '@neumar/video-ir';

import { createLogger } from '@/shared/utils/logger';

import type { VideoPlugin } from '../plugins/types';

const logger = createLogger('VideoOverlayPluginPresets');

// Data-only vivid-overlay preset packs contributed by video plugins. A plugin
// preset may only recombine BUILT-IN backends and documents with its own
// labels, controls, and defaults — never code or new documents — so merging
// one is a pure data operation behind the plugin trust gate.

/** Trust tiers whose data contributions merge without a per-run prompt. */
const TRUSTED_TIERS = new Set(['bundled', 'saved', 'local']);

const pluginPresets = new Map<string, VividOverlayPresetDef[]>();

export function clearPluginOverlayPresetsForTests(): void {
  pluginPresets.clear();
}

export function registerVideoPluginOverlayPresets(plugin: VideoPlugin): void {
  const contributions = plugin.manifest.video.overlayPresets ?? [];
  if (contributions.length === 0) return;
  if (!TRUSTED_TIERS.has(plugin.trustTier)) {
    logger.warn('video.overlay_presets.untrusted_plugin_skipped', {
      plugin_id: plugin.id,
      trust_tier: plugin.trustTier,
      preset_count: contributions.length,
    });
    return;
  }
  const accepted: VividOverlayPresetDef[] = [];
  for (const contribution of contributions) {
    if (!documentIdIsBuiltIn(contribution.backend, contribution.documentId)) {
      logger.warn('video.overlay_presets.unknown_document_rejected', {
        plugin_id: plugin.id,
        preset_id: contribution.id,
        document_id: contribution.documentId,
      });
      continue;
    }
    accepted.push({
      // Namespaced so plugin presets can never shadow built-ins.
      id: `plugin:${plugin.id}/${contribution.id}`,
      backend: contribution.backend,
      category: contribution.category,
      // Plugin labels are display strings, not i18n keys; the rail/inspector
      // label resolver falls back to the raw value for unknown keys.
      labelKey: contribution.label,
      descriptionKey: contribution.description,
      controls: contribution.controls.map(toControlDef),
      capability: 'native',
      documentId: contribution.documentId,
      requiresSourceAsset: contribution.requiresSourceAsset,
      defaultDurationMs: contribution.defaultDurationMs,
      minDurationMs: contribution.minDurationMs,
    });
  }
  if (accepted.length > 0) {
    pluginPresets.set(plugin.id, accepted);
    logger.info('video.overlay_presets.registered', {
      plugin_id: plugin.id,
      preset_count: accepted.length,
    });
  }
}

export function findPluginOverlayPreset(
  presetId: string,
): VividOverlayPresetDef | undefined {
  if (!presetId.startsWith('plugin:')) return undefined;
  for (const presets of pluginPresets.values()) {
    const match = presets.find((preset) => preset.id === presetId);
    if (match) return match;
  }
  return undefined;
}

export function listPluginOverlayPresets(): VividOverlayPresetDef[] {
  return [...pluginPresets.values()].flat();
}

function documentIdIsBuiltIn(
  backend: VividOverlayPresetDef['backend'],
  documentId: string | undefined,
): boolean {
  switch (backend) {
    case 'html':
    case 'text-motion':
      return Boolean(documentId && vividOverlayDocument(documentId));
    case 'lottie':
      return Boolean(
        documentId?.startsWith('lottie:') &&
        VIVID_OVERLAY_LOTTIE_ASSETS[documentId.slice('lottie:'.length)],
      );
    case 'gif':
      // gif presets carry no document; the clip's sourceAssetId supplies it.
      return documentId === undefined;
    default:
      return false;
  }
}

function toControlDef(control: {
  id: string;
  type: VividOverlayControlDef['type'];
  label: string;
  defaultValue: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}): VividOverlayControlDef {
  return {
    id: control.id,
    type: control.type,
    labelKey: control.label,
    defaultValue: control.defaultValue,
    min: control.min,
    max: control.max,
    step: control.step,
    options: control.options,
  };
}
