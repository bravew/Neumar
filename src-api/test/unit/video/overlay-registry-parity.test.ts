import {
  vividOverlayControlDefaults,
  type VividOverlayPresetDef,
} from '@neumar/video-ir';
import { describe, expect, it } from 'vitest';

import {
  resolveVividOverlay,
  VIDEO_OVERLAY_REGISTRY as apiRegistry,
} from '@/shared/video/overlays/registry';

import { VIDEO_OVERLAY_REGISTRY as uiRegistry } from '../../../../src/shared/video/overlays/registry';

const TASTE_SEED_PRESET_IDS = [
  'html.marker-highlight',
  'html.lower-third',
  'text.title-pop',
  'lottie.motion-favorite',
  'lottie.motion-fab',
  'lottie.motion-pagination',
  'lottie.motion-tab',
  'html.subscribe-button',
  'html.floating-hearts',
  'html.progress-top',
  'html.vignette',
  'html.rounded-frame',
] as const;

describe('vivid overlay registry parity', () => {
  it('keeps frontend and backend overlay catalogs in sync', () => {
    expect(registryShape(apiRegistry)).toEqual(registryShape(uiRegistry));
  });

  it('pins the catalog order', () => {
    expect(apiRegistry.map((preset) => preset.id)).toEqual([
      'html.marker-highlight',
      'html.lower-third',
      'html.callout-box',
      'text.title-pop',
      'sticker.gif',
      'lottie.pulse',
      // wave 1 (07-07 plan CP4)
      'text.kinetic-words',
      'text.tracking-expand',
      'text.glitch-title',
      'text.neon-glow',
      'text.typewriter',
      'html.masked-reveal',
      'html.lower-third-glass',
      'html.lower-third-broadcast',
      'html.lower-third-social',
      'html.lower-third-minimal',
      'html.circle-marker',
      'html.arrow-label',
      'html.spotlight-dim',
      'html.step-pin',
      'html.underline-sweep',
      'html.live-pill',
      'html.ribbon-corner',
      'html.rating-stars',
      'html.verified-pop',
      'lottie.confetti',
      'lottie.motion-favorite',
      'lottie.motion-fab',
      'lottie.motion-pagination',
      'lottie.motion-tab',
      // wave 2 (catalog wave 2)
      'html.subscribe-button',
      'html.follow-reminder',
      'html.link-in-bio',
      'html.corner-bug',
      'html.notification-toast',
      'html.cta-banner',
      'html.floating-hearts',
      'html.emoji-rain',
      'html.fire-streak',
      'html.clap-burst',
      'html.chat-bubbles',
      'html.comment-card',
      'html.quote-card',
      'html.progress-top',
      'html.progress-chapters',
      'html.countdown-ring',
      'html.part-indicator',
      'html.counter-ticker',
      'html.vs-card',
      'html.percentage-ring',
      // wave 3 (catalog wave 3)
      'html.vignette',
      'html.film-grain',
      'html.vhs-scanlines',
      'html.light-leak',
      'html.bokeh-particles',
      'html.snow',
      'html.rain',
      'html.letterbox',
      'html.rgb-split-pulse',
      'html.rounded-frame',
      'html.polaroid',
      'html.phone-mockup',
      'html.tape-corners',
      'html.neon-border',
      'html.location-pin',
      'html.timestamp-chip',
      'html.now-playing',
      'html.hashtag-chip',
    ]);
  });

  it('every preset has valid defaults and required metadata', () => {
    for (const preset of apiRegistry) {
      expect(preset.labelKey).toMatch(/^overlays\./);
      expect(preset.descriptionKey).toMatch(/^overlays\./);
      expect(preset.defaultDurationMs).toBeGreaterThanOrEqual(
        preset.minDurationMs,
      );
      if (preset.backend === 'html') {
        expect(preset.documentId).toBeTruthy();
      }
      const defaults = vividOverlayControlDefaults(preset.controls);
      const resolved = resolveVividOverlay({
        presetId: preset.id,
        backend: preset.backend,
        controls: defaults,
      });
      expect(resolved).not.toBeNull();
      expect(resolved!.errors).toEqual([]);
    }
  });

  it('exposes taste metadata for router seed presets', () => {
    expect(
      apiRegistry.filter((preset) => preset.taste).map((preset) => preset.id),
    ).toEqual(TASTE_SEED_PRESET_IDS);

    for (const presetId of TASTE_SEED_PRESET_IDS) {
      const preset = apiRegistry.find((candidate) => candidate.id === presetId);
      const taste = preset?.taste;
      expect(taste).toBeDefined();
      if (!taste) throw new Error(`Missing taste metadata for ${presetId}`);

      expect(taste.intent.length).toBeGreaterThan(0);
      expect(taste.targets.length).toBeGreaterThan(0);
      expect(taste.bestFor.length).toBeGreaterThan(0);
      expect(taste.avoidWhen.length).toBeGreaterThan(0);
      expect(taste.reducedMotion).toBeTruthy();
      expect(taste.motionTokens).toBeTruthy();
    }

    expect(
      apiRegistry.find((preset) => preset.id === 'html.marker-highlight')
        ?.taste,
    ).toMatchObject({
      intent: 'annotation',
      targets: ['text', 'section'],
      restraint: { maxPerScene: 1, maxSimultaneous: 1 },
      reducedMotion: 'poster',
    });
    expect(
      apiRegistry.find((preset) => preset.id === 'html.vignette')?.taste,
    ).toMatchObject({
      intent: 'ambient',
      restraint: { loopPolicy: 'single-ambient' },
    });
  });

  it('rejects unknown presets and backend mismatches', () => {
    expect(
      resolveVividOverlay({ presetId: 'nope', backend: 'html', controls: {} }),
    ).toBeNull();
    expect(
      resolveVividOverlay({
        presetId: 'html.marker-highlight',
        backend: 'gif',
        controls: {},
      }),
    ).toBeNull();
  });

  it('reports control validation problems through resolveVividOverlay', () => {
    const resolved = resolveVividOverlay({
      presetId: 'html.marker-highlight',
      backend: 'html',
      controls: { fontSize: 9999, mystery: true },
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.errors).toEqual([
      'Control fontSize above max 160',
      'Unknown control: mystery',
    ]);
    // stored values overlay preset defaults
    expect(resolved!.controls.text).toBe('Highlight this');
    expect(resolved!.controls.fontSize).toBe(9999);
  });
});

function registryShape(registry: readonly VividOverlayPresetDef[]) {
  return registry.map((preset) => ({
    id: preset.id,
    backend: preset.backend,
    category: preset.category,
    labelKey: preset.labelKey,
    descriptionKey: preset.descriptionKey,
    controls: preset.controls,
    capability: preset.capability,
    documentId: preset.documentId,
    requiresSourceAsset: preset.requiresSourceAsset,
    defaultDurationMs: preset.defaultDurationMs,
    minDurationMs: preset.minDurationMs,
    license: preset.license,
    tags: preset.tags,
    previewPosterMs: preset.previewPosterMs,
    previewBackground: preset.previewBackground,
    aspectAffinity: preset.aspectAffinity,
    anchor: preset.anchor,
    taste: preset.taste,
  }));
}
