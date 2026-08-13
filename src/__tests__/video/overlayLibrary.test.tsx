import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  defaultOverlayClipDurationMs,
  readOverlayPresetDrag,
  writeOverlayPresetDrag,
  OVERLAY_PRESET_DRAG_MIME,
} from '@/components/video/overlays/overlayDragPayload';
import { OverlayLibraryRail } from '@/components/video/overlays/OverlayLibraryRail';
import { timelineClipFromOverlayPreset } from '@/components/video/timeline/droppedOverlayClip';
import { LanguageProvider } from '@/shared/providers/language-provider';

vi.mock('@/components/video/overlays/useUserOverlayPresets', () => ({
  useUserOverlayPresets: () => ({
    presets: [
      {
        id: 'user:green',
        name: 'Green highlight',
        basePresetId: 'html.marker-highlight',
        controls: { color: '#008000' },
        createdAt: '2026-07-08T00:00:00.000Z',
      },
    ],
    remove: () => {},
    save: async () => true,
  }),
}));

vi.mock('@/components/video/overlays/useUserOverlayStyles', () => ({
  useUserOverlayStyles: () => ({
    styles: [
      {
        id: 'style:pinned',
        name: 'Pinned green style',
        basePresetId: 'html.marker-highlight',
        controls: { text: 'Pinned', color: '#008000' },
        tags: ['green', 'pinned'],
        provenance: {
          kind: 'saved-from-timeline',
          createdAt: '2026-07-08T00:00:00.000Z',
        },
      },
    ],
    remove: () => {},
    save: async () => true,
  }),
}));

vi.mock('@/components/video/overlays/useImportedOverlays', () => ({
  importedOverlayAssetUrl: (id: string) => `/video/overlay-imports/${id}/asset`,
  useImportedOverlays: () => ({
    importLocal: async () => true,
    imports: [
      {
        id: 'import:green',
        name: 'Green sparkle',
        kind: 'gif',
        relativePath: 'overlay-imports/import-green.gif',
        source: {
          kind: 'local-upload',
          fileName: 'green-sparkle.gif',
          mimeType: 'image/gif',
          sizeBytes: 1280,
        },
        provenance: {
          kind: 'import',
          provider: 'local',
          createdAt: '2026-07-08T00:00:00.000Z',
        },
      },
      {
        id: 'import:clock',
        name: 'Loading sand clock',
        kind: 'lottie',
        relativePath: 'overlay-imports/import-clock.json',
        source: {
          kind: 'local-upload',
          fileName: 'Loading sand clock.json',
          mimeType: 'application/json',
          sizeBytes: 4096,
        },
        provenance: {
          kind: 'import',
          provider: 'local',
          createdAt: '2026-07-08T00:00:00.000Z',
        },
      },
    ],
    remove: () => {},
  }),
}));

function renderRail() {
  return render(
    <LanguageProvider>
      <OverlayLibraryRail />
    </LanguageProvider>,
  );
}

class FakeDataTransfer {
  data = new Map<string, string>();
  effectAllowed = '';
  get types() {
    return [...this.data.keys()];
  }
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? '';
  }
}

describe('OverlayLibraryRail', () => {
  it('lists every catalog preset as a draggable tile', () => {
    renderRail();
    for (const presetId of [
      'html.marker-highlight',
      'html.lower-third',
      'text.title-pop',
      'sticker.gif',
      'lottie.pulse',
      'lottie.motion-favorite',
      'lottie.motion-fab',
      'lottie.motion-pagination',
      'lottie.motion-tab',
    ]) {
      const tile = document.querySelector(
        `[data-overlay-preset="${presetId}"]`,
      );
      expect(tile, presetId).not.toBeNull();
      expect(tile!.getAttribute('draggable')).toBe('true');
    }
    // gif sticker surfaces its asset requirement
    expect(screen.getByText('Needs an asset')).toBeInTheDocument();
  });

  it('keeps saved overlays visible under active search filters', () => {
    renderRail();

    fireEvent.change(screen.getByLabelText('Search overlays'), {
      target: { value: 'green' },
    });

    expect(screen.getByText('Green highlight')).toBeInTheDocument();
    expect(screen.getByText('Pinned green style')).toBeInTheDocument();
    expect(screen.getByText('Green sparkle')).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Filter by source' }),
    ).toBeInTheDocument();
  });

  it('filters the rail to imported overlays by source', () => {
    renderRail();

    fireEvent.click(screen.getByRole('button', { name: 'Imported' }));

    expect(screen.getByText('Green sparkle')).toBeInTheDocument();
    expect(screen.getByText('Loading sand clock')).toBeInTheDocument();
    expect(
      document.querySelector('[data-overlay-preset="html.marker-highlight"]'),
    ).toBeNull();
  });

  it('makes imported Lottie overlays draggable', () => {
    renderRail();
    const tile = document.querySelector(
      '[data-imported-overlay="import:clock"]',
    );
    expect(tile).not.toBeNull();
    expect(tile!.getAttribute('draggable')).toBe('true');

    const dt = new FakeDataTransfer() as unknown as DataTransfer;
    fireEvent.dragStart(tile!, { dataTransfer: dt });
    expect(readOverlayPresetDrag(dt)).toEqual({
      type: 'imported-overlay',
      importId: 'import:clock',
      kind: 'lottie',
      clipDurationMs: 4000,
      name: 'Loading sand clock',
    });
  });
});

describe('overlay drag payload round-trip', () => {
  it('writes and reads the payload', () => {
    const dt = new FakeDataTransfer() as unknown as DataTransfer;
    writeOverlayPresetDrag(dt, {
      type: 'vivid-overlay-preset',
      presetId: 'text.title-pop',
      clipDurationMs: 2200,
    });
    expect([...(dt.types as string[])]).toContain(OVERLAY_PRESET_DRAG_MIME);
    expect(readOverlayPresetDrag(dt)).toEqual({
      type: 'vivid-overlay-preset',
      presetId: 'text.title-pop',
      clipDurationMs: 2200,
    });
  });

  it('rejects unknown presets and falls back sanely on durations', () => {
    const dt = new FakeDataTransfer() as unknown as DataTransfer;
    dt.setData(
      OVERLAY_PRESET_DRAG_MIME,
      JSON.stringify({ type: 'vivid-overlay-preset', presetId: 'nope' }),
    );
    expect(readOverlayPresetDrag(dt)).toBeNull();
    // gif preset's huge wrap duration clamps to a droppable clip length
    expect(defaultOverlayClipDurationMs('sticker.gif')).toBe(4000);
  });

  it('writes and reads imported overlay payloads', () => {
    const dt = new FakeDataTransfer() as unknown as DataTransfer;
    writeOverlayPresetDrag(dt, {
      type: 'imported-overlay',
      importId: 'import:clock',
      kind: 'lottie',
      clipDurationMs: 4200,
      name: 'Loading sand clock',
    });
    expect([...(dt.types as string[])]).toContain(OVERLAY_PRESET_DRAG_MIME);
    expect(readOverlayPresetDrag(dt)).toEqual({
      type: 'imported-overlay',
      importId: 'import:clock',
      kind: 'lottie',
      clipDurationMs: 4200,
      name: 'Loading sand clock',
    });
  });
});

describe('timelineClipFromOverlayPreset', () => {
  it('builds a valid effect clip with preset defaults', () => {
    const clip = timelineClipFromOverlayPreset(
      {
        type: 'vivid-overlay-preset',
        presetId: 'html.marker-highlight',
        clipDurationMs: 2500,
      },
      1200,
    );
    expect(clip).toMatchObject({
      kind: 'effect',
      effectType: 'vivid-overlay',
      startMs: 1200,
      durationMs: 2500,
      params: {
        presetId: 'html.marker-highlight',
        backend: 'html',
        loop: 'hold',
        controls: {
          text: 'Highlight this',
          color: '#ffd166',
          fontSize: 64,
        },
      },
    });
  });

  it('builds a source-backed effect clip for imported Lottie overlays', () => {
    const clip = timelineClipFromOverlayPreset(
      {
        type: 'imported-overlay',
        importId: 'import:clock',
        kind: 'lottie',
        clipDurationMs: 4000,
        name: 'Loading sand clock',
      },
      900,
    );
    expect(clip).toMatchObject({
      kind: 'effect',
      effectType: 'vivid-overlay',
      name: 'Loading sand clock',
      startMs: 900,
      durationMs: 4000,
      params: {
        presetId: 'imported.lottie',
        backend: 'lottie',
        controls: {},
        sourceAssetId: 'import:clock',
        loop: 'loop',
      },
    });
  });
});
