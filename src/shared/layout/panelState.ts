export type PanelStateId = 'A' | 'B' | 'C';

export interface PanelRecord {
  state: PanelStateId;
  /** State to restore when focus (C) is dismissed. Never C. */
  restore: 'A' | 'B';
}

const RAIL_WIDTH = 56;
const PANEL_WIDTH = 264;
const MIN_READING_WIDTH = 560;
/** Show the panel whenever it fits beside a readable column, like muse. */
const PANEL_MIN_VIEWPORT = RAIL_WIDTH + PANEL_WIDTH + MIN_READING_WIDTH;

export function defaultPanelRecord(width: number): PanelRecord {
  const state = width < PANEL_MIN_VIEWPORT ? 'B' : 'A';
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
