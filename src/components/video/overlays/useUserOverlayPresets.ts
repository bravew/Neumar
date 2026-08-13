import { useCallback, useEffect, useState } from 'react';

import { API_BASE_URL } from '@/config';

// "My overlays": user-saved overlay presets (07-07 plan CP6). A saved preset
// is a bookmark over a built-in base preset — see the server store in
// src-api/src/shared/video/overlays/user-presets.ts.

export interface UserOverlayPreset {
  id: string;
  name: string;
  basePresetId: string;
  controls: Record<string, string | number | boolean>;
  loop?: 'loop' | 'hold' | 'none';
  createdAt: string;
}

export interface SaveUserOverlayPresetInput {
  name: string;
  basePresetId: string;
  controls: Record<string, string | number | boolean>;
  loop?: 'loop' | 'hold' | 'none';
}

const PRESETS_URL = `${API_BASE_URL}/video/overlay-presets`;

/** Fired after a save elsewhere (e.g. the clip inspector) so lists re-sync. */
export const USER_OVERLAY_PRESETS_CHANGED = 'neuma:user-overlay-presets';

export function useUserOverlayPresets() {
  const [presets, setPresets] = useState<UserOverlayPreset[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      fetch(PRESETS_URL, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { presets?: UserOverlayPreset[] } | null) => {
          if (payload?.presets) setPresets(payload.presets);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(USER_OVERLAY_PRESETS_CHANGED, load);
    return () => {
      controller.abort();
      window.removeEventListener(USER_OVERLAY_PRESETS_CHANGED, load);
    };
  }, []);

  const save = useCallback(
    async (input: SaveUserOverlayPresetInput): Promise<boolean> => {
      try {
        const response = await fetch(PRESETS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as {
          preset?: UserOverlayPreset;
        };
        if (payload.preset) {
          const saved = payload.preset;
          setPresets((prev) => [...prev, saved]);
        }
        window.dispatchEvent(new Event(USER_OVERLAY_PRESETS_CHANGED));
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch(`${PRESETS_URL}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setPresets((prev) => prev.filter((preset) => preset.id !== id));
      }
    } catch {
      // keep the list as-is; a refresh re-syncs
    }
  }, []);

  return { presets, save, remove };
}
