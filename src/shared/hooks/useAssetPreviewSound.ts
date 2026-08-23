import { create } from 'zustand';

const STORAGE_KEY = 'neuma.assetPreview.sound';

function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    // localStorage unavailable (private mode, embedded webview) — stay quiet.
    return false;
  }
}

function writeStoredPreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // Preference just won't survive a reload.
  }
}

interface AssetPreviewSoundState {
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  toggleSound: () => void;
}

/**
 * Whether asset previews play with sound, shared by every hover preview and
 * remembered across reloads.
 *
 * One preference rather than a per-preview toggle: having unmuted one clip you
 * mean "let me hear these", and the next one you hover should behave the same
 * way. Defaults to muted because a list of assets that starts making noise as
 * the pointer crosses it is hostile — the user opts in once.
 */
export const useAssetPreviewSoundStore = create<AssetPreviewSoundState>(
  (set, get) => ({
    soundEnabled: readStoredPreference(),
    setSoundEnabled: (enabled) => {
      writeStoredPreference(enabled);
      set({ soundEnabled: enabled });
    },
    toggleSound: () => get().setSoundEnabled(!get().soundEnabled),
  }),
);

export function useAssetPreviewSound(): {
  soundEnabled: boolean;
  toggleSound: () => void;
  setSoundEnabled: (enabled: boolean) => void;
} {
  const soundEnabled = useAssetPreviewSoundStore((s) => s.soundEnabled);
  const toggleSound = useAssetPreviewSoundStore((s) => s.toggleSound);
  const setSoundEnabled = useAssetPreviewSoundStore((s) => s.setSoundEnabled);
  return { soundEnabled, toggleSound, setSoundEnabled };
}
