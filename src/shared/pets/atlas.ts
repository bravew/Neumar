export const PET_ATLAS_COLS = 8;
export const PET_ATLAS_ROWS = 9;

export type PetAtlasRowId =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review';

export interface PetAtlasRowDef {
  index: number;
  id: PetAtlasRowId;
  frames: number;
  fps: number;
}

export interface PetAtlasLayout {
  cols: number;
  rows: number;
  rowsDef: PetAtlasRowDef[];
}

export const PET_ATLAS_ROWS_DEF = [
  { index: 0, id: 'idle', frames: 6, fps: 6 },
  { index: 1, id: 'running-right', frames: 8, fps: 8 },
  { index: 2, id: 'running-left', frames: 8, fps: 8 },
  { index: 3, id: 'waving', frames: 4, fps: 6 },
  { index: 4, id: 'jumping', frames: 5, fps: 7 },
  { index: 5, id: 'failed', frames: 8, fps: 7 },
  { index: 6, id: 'waiting', frames: 6, fps: 6 },
  { index: 7, id: 'running', frames: 6, fps: 8 },
  { index: 8, id: 'review', frames: 6, fps: 6 },
] satisfies PetAtlasRowDef[];

export const PET_ATLAS_LAYOUT = {
  cols: PET_ATLAS_COLS,
  rows: PET_ATLAS_ROWS,
  rowsDef: PET_ATLAS_ROWS_DEF,
} satisfies PetAtlasLayout;
