import {
  vividOverlayPreviewPosterMs,
  type VividOverlayPresetDef,
} from '@neumar/video-ir';
import { describe, expect, it } from 'vitest';

import { overlayPresetPreviewSrcdoc } from '@/components/video/overlays/OverlayCardPreview';
import { VIDEO_OVERLAY_REGISTRY } from '@/shared/video/overlays/registry';

const PRESETS: readonly VividOverlayPresetDef[] = VIDEO_OVERLAY_REGISTRY;

describe('overlay card previews', () => {
  it('builds an instantiated preview document for every document-backed preset', () => {
    for (const preset of PRESETS) {
      const srcdoc = overlayPresetPreviewSrcdoc(preset);
      if (preset.requiresSourceAsset) {
        expect(srcdoc).toBeNull();
        continue;
      }
      expect(srcdoc, preset.id).toBeTruthy();
      // instantiated with the preset's default controls and the design size
      expect(srcdoc).toContain('__overlayParams');
      expect(srcdoc).toContain('"widthPx":640');
    }
  });

  it('defaults the poster time to 60% of the authored duration', () => {
    expect(vividOverlayPreviewPosterMs({ defaultDurationMs: 2500 })).toBe(1500);
    expect(
      vividOverlayPreviewPosterMs({
        defaultDurationMs: 2500,
        previewPosterMs: 400,
      }),
    ).toBe(400);
  });
});
