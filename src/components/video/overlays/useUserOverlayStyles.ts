import { useCallback, useEffect, useState } from 'react';

import type {
  KeyframeTrack,
  VividOverlayControlValue,
  VividOverlayLoopMode,
  VividOverlayStyle,
  VividOverlayStyleProvenanceKind,
  VividOverlayStyleTransform,
  VividOverlayTasteMetadata,
} from '@neumar/video-ir';

import { API_BASE_URL } from '@/config';

export type UserOverlayStyle = VividOverlayStyle;

export interface SaveUserOverlayStyleInput {
  name: string;
  basePresetId: string;
  controls: Record<string, VividOverlayControlValue>;
  loop?: VividOverlayLoopMode;
  transform?: VividOverlayStyleTransform;
  keyframes?: KeyframeTrack[];
  tags?: string[];
  taste?: VividOverlayTasteMetadata;
  provenance: {
    kind: VividOverlayStyleProvenanceKind;
    sourceId?: string;
  };
}

const STYLES_URL = `${API_BASE_URL}/video/overlay-styles`;

export const USER_OVERLAY_STYLES_CHANGED = 'neuma:user-overlay-styles';

export function useUserOverlayStyles() {
  const [styles, setStyles] = useState<UserOverlayStyle[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      fetch(STYLES_URL, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { styles?: UserOverlayStyle[] } | null) => {
          if (payload?.styles) setStyles(payload.styles);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(USER_OVERLAY_STYLES_CHANGED, load);
    return () => {
      controller.abort();
      window.removeEventListener(USER_OVERLAY_STYLES_CHANGED, load);
    };
  }, []);

  const save = useCallback(
    async (input: SaveUserOverlayStyleInput): Promise<boolean> => {
      try {
        const response = await fetch(STYLES_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (!response.ok) return false;
        const payload = (await response.json()) as {
          style?: UserOverlayStyle;
        };
        if (payload.style) {
          const saved = payload.style;
          setStyles((prev) => [...prev, saved]);
        }
        window.dispatchEvent(new Event(USER_OVERLAY_STYLES_CHANGED));
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      const response = await fetch(`${STYLES_URL}/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setStyles((prev) => prev.filter((style) => style.id !== id));
      }
    } catch {
      // keep the list as-is; a refresh re-syncs
    }
  }, []);

  return { remove, save, styles };
}
