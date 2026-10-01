export type PanelStateId = 'A' | 'B' | 'C';

export interface PanelRecord {
  state: PanelStateId;
  /** State to restore when focus (C) is dismissed. Never C. */
  restore: 'A' | 'B';
}

export function defaultPanelRecord(width: number): PanelRecord {
  const state = width < 1100 ? 'B' : 'A';
  return { state, restore: state };
}

/** ⌘B: A → B → C → A. Entering C remembers the state just left. */
export function cyclePanel(record: PanelRecord): PanelRecord {
  if (record.state === 'A') return { ...record, state: 'B' };
  if (record.state === 'B') return { state: 'C', restore: 'B' };
  return { ...record, state: 'A' };
}

/** ⌘.: hide everything, or restore the state from before focus. */
export function toggleFocus(record: PanelRecord): PanelRecord {
  if (record.state === 'C') return { ...record, state: record.restore };
  return { state: 'C', restore: record.state };
}

/**
 * Editor routes that bring their own side panels (agent, inspector). The
 * context panel would be a second left column there, so they keep a separate
 * panel record that starts rail-only.
 */
const CANVAS_PATHS = [
  /^\/design\/[^/]+\/?$/,
  /^\/video\/[^/]+(\/timeline)?\/?$/,
];

export function isCanvasPath(pathname: string): boolean {
  return CANVAS_PATHS.some((pattern) => pattern.test(pathname));
}

export function defaultCanvasPanelRecord(): PanelRecord {
  return { state: 'B', restore: 'B' };
}

/** Design Mode draws its own full-page layout when the simple shell is off. */
export function isDesignPath(pathname: string): boolean {
  return pathname === '/design' || pathname.startsWith('/design/');
}
