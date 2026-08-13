import type { PetAtlasLayout, PetAtlasRowDef } from './atlas';

export type PetInteraction =
  | 'idle'
  | 'hover'
  | 'drag-right'
  | 'drag-left'
  | 'drag-up'
  | 'drag-down'
  | 'waiting'
  | 'failed'
  | 'review';

const INTERACTION_ROW_ID: Record<PetInteraction, string> = {
  idle: 'idle',
  hover: 'waving',
  'drag-right': 'running-right',
  'drag-left': 'running-left',
  'drag-up': 'jumping',
  'drag-down': 'waving',
  waiting: 'waiting',
  failed: 'failed',
  review: 'review',
};

const ROW_FALLBACK_ORDER = [
  'idle',
  'waiting',
  'waving',
  'running',
  'running-right',
] as const;

const AMBIENT_ROW_IDS: readonly string[] = [
  'waving',
  'review',
  'jumping',
  'running',
  'running-right',
  'running-left',
];

export function preferredRowId(state: PetInteraction): string {
  return INTERACTION_ROW_ID[state];
}

export function pickAtlasRow(
  layout: PetAtlasLayout | undefined,
  preferred: string,
): PetAtlasRowDef | undefined {
  if (!layout || layout.rowsDef.length === 0) return undefined;

  const direct = layout.rowsDef.find((row) => row.id === preferred);
  if (direct) return direct;

  for (const id of ROW_FALLBACK_ORDER) {
    const fallback = layout.rowsDef.find((row) => row.id === id);
    if (fallback) return fallback;
  }

  return layout.rowsDef[0];
}

export function pickAmbientRowId(
  layout: PetAtlasLayout | undefined,
  avoidId: string | null,
): string | null {
  const rows = layout?.rowsDef.filter((row) =>
    AMBIENT_ROW_IDS.includes(row.id),
  );
  if (!rows?.length) return null;

  const candidates = avoidId ? rows.filter((row) => row.id !== avoidId) : rows;
  const choices = candidates.length > 0 ? candidates : rows;

  return choices[Math.floor(Math.random() * choices.length)]?.id ?? null;
}

export function randomBetween(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}
