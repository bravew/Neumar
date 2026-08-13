import { APP_SLUG } from '@/config/branding';

const CREATIVE_DEBUG_COUNTER_EVENTS = [
  'entry.intent.selected',
  'asset.search.used',
  'generate.panel.opened',
  'generation.submitted',
  'flow.viewer.opened',
  'recovery.action.used',
  'agent.suggestion.selected',
  'prompt.library.opened',
  'prompt.library.sample.used',
] as const;

export type CreativeDebugCounterEvent =
  (typeof CREATIVE_DEBUG_COUNTER_EVENTS)[number];

export interface CreativeDebugCounterEntry {
  count: number;
  lastAt: string;
}

export interface CreativeDebugCounterSnapshot {
  version: 1;
  updatedAt: string | null;
  events: Partial<Record<CreativeDebugCounterEvent, CreativeDebugCounterEntry>>;
}

export const CREATIVE_DEBUG_COUNTER_STORAGE_KEY = `${APP_SLUG}:creative-debug-counters`;

const EVENT_SET = new Set<string>(CREATIVE_DEBUG_COUNTER_EVENTS);
const DEFAULT_DEDUPE_MS = 1_000;
const recentCounterKeys = new Map<string, number>();

export function recordCreativeDebugCounter(
  event: CreativeDebugCounterEvent,
  now = new Date(),
): void {
  const storage = getLocalStorage();
  if (!storage) return;

  const timestamp = now.toISOString();
  const snapshot = readCreativeDebugCounters();
  const current = snapshot.events[event];
  const nextSnapshot: CreativeDebugCounterSnapshot = {
    version: 1,
    updatedAt: timestamp,
    events: {
      ...snapshot.events,
      [event]: {
        count: (current?.count ?? 0) + 1,
        lastAt: timestamp,
      },
    },
  };

  try {
    storage.setItem(
      CREATIVE_DEBUG_COUNTER_STORAGE_KEY,
      JSON.stringify(nextSnapshot),
    );
  } catch {
    // Best-effort local diagnostics only.
  }
}

export function recordCreativeDebugCounterOnce(
  event: CreativeDebugCounterEvent,
  key: string,
  now = new Date(),
  dedupeMs = DEFAULT_DEDUPE_MS,
): boolean {
  const dedupeKey = `${event}:${key}`;
  const time = now.getTime();
  const lastTime = recentCounterKeys.get(dedupeKey);
  if (lastTime !== undefined && time - lastTime < dedupeMs) {
    return false;
  }

  for (const [storedKey, storedTime] of recentCounterKeys) {
    if (time - storedTime >= dedupeMs) recentCounterKeys.delete(storedKey);
  }
  recentCounterKeys.set(dedupeKey, time);
  recordCreativeDebugCounter(event, now);
  return true;
}

export function readCreativeDebugCounters(): CreativeDebugCounterSnapshot {
  const storage = getLocalStorage();
  if (!storage) return emptyCreativeDebugCounters();

  try {
    return normalizeSnapshot(
      JSON.parse(storage.getItem(CREATIVE_DEBUG_COUNTER_STORAGE_KEY) ?? 'null'),
    );
  } catch {
    return emptyCreativeDebugCounters();
  }
}

export function clearCreativeDebugCounters(): void {
  recentCounterKeys.clear();
  const storage = getLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(CREATIVE_DEBUG_COUNTER_STORAGE_KEY);
  } catch {
    // Best-effort local diagnostics only.
  }
}

function emptyCreativeDebugCounters(): CreativeDebugCounterSnapshot {
  return { version: 1, updatedAt: null, events: {} };
}

function normalizeSnapshot(value: unknown): CreativeDebugCounterSnapshot {
  if (!isRecord(value) || !isRecord(value.events)) {
    return emptyCreativeDebugCounters();
  }

  const events: CreativeDebugCounterSnapshot['events'] = {};
  for (const [event, entry] of Object.entries(value.events)) {
    if (!EVENT_SET.has(event) || !isRecord(entry)) continue;
    if (typeof entry.count !== 'number' || typeof entry.lastAt !== 'string') {
      continue;
    }
    events[event as CreativeDebugCounterEvent] = {
      count: Math.max(0, Math.floor(entry.count)),
      lastAt: entry.lastAt,
    };
  }

  return {
    version: 1,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    events,
  };
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
