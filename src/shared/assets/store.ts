import { createStore } from 'zustand/vanilla';

export interface AssetSelectionState {
  selectedIds: string[];
  clear: () => void;
  remove: (id: string) => void;
  setSelected: (ids: string[]) => void;
  toggle: (id: string) => void;
}

export function createAssetSelectionStore() {
  return createStore<AssetSelectionState>()((set) => ({
    selectedIds: [],
    clear: () => set({ selectedIds: [] }),
    remove: (id) =>
      set((state) => ({
        selectedIds: state.selectedIds.filter(
          (selectedId) => selectedId !== id,
        ),
      })),
    setSelected: (ids) => set({ selectedIds: Array.from(new Set(ids)) }),
    toggle: (id) =>
      set((state) => ({
        selectedIds: state.selectedIds.includes(id)
          ? state.selectedIds.filter((selectedId) => selectedId !== id)
          : [...state.selectedIds, id],
      })),
  }));
}
