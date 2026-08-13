/**
 * Replay recordings for the mock agent — adapted from open-design's
 * `mocks/` corpus (_sample/open-design/mocks/lib/recording-picker.mjs).
 *
 * A recording is a JSONL file: the first line is a `meta` object, each
 * subsequent line is an event the mock agent replays as a neuma AgentMessage.
 * Recordings are tiny, committed fixtures — no LLM tokens, no network.
 *
 * Selection is env-driven so an e2e harness can pin a deterministic trace:
 *   NEUMA_MOCK_TRACE=hello-read-edit   exact id, or unique filename prefix
 *   NEUMA_MOCK_POOL=outcome:succeeded  agent:<name> | outcome:<v> | <tag>
 *   NEUMA_MOCK_SEED=<any>              reproducible "random" pick
 *   NEUMA_MOCK_RECORDINGS_DIR=<dir>    override the fixtures dir
 *   NEUMA_MOCK_NO_DELAY=1              skip inter-event sleeps (fast tests)
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export interface MockRecordingMeta {
  type: 'meta';
  /** Stable id; defaults to the filename stem when omitted. */
  id?: string;
  /** Agent the trace was captured from (claude, codex, …) — for pools. */
  agent?: string;
  model?: string;
  /** succeeded | failed | errored — for `NEUMA_MOCK_POOL=outcome:<v>`. */
  outcome?: string;
  tags?: string[];
  description?: string;
}

/** One replayable step. `t_ms` is elapsed ms from session start (optional). */
export type MockEvent =
  | { type: 'text'; content: string; t_ms?: number }
  | { type: 'thinking'; content: string; t_ms?: number }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      input?: unknown;
      t_ms?: number;
    }
  | { type: 'tool_result'; id: string; output: string; isError?: boolean }
  | { type: 'report'; content: string; t_ms?: number }
  | { type: 'error'; content: string; t_ms?: number };

export interface LoadedRecording {
  id: string;
  meta: MockRecordingMeta;
  events: MockEvent[];
  path: string;
  /** How the picker chose this trace — surfaced in logs. */
  method: 'fixed' | 'pool' | 'random';
}

function recordingsDir(): string {
  return process.env.NEUMA_MOCK_RECORDINGS_DIR || join(HERE, 'recordings');
}

function listTraceIds(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.replace(/\.jsonl$/, ''))
      .sort();
  } catch {
    return [];
  }
}

function parseRecording(dir: string, id: string): LoadedRecording {
  const path = join(dir, `${id}.jsonl`);
  const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  const records = lines.map((line, i) => {
    try {
      return JSON.parse(line) as MockRecordingMeta | MockEvent;
    } catch (err) {
      throw new Error(
        `mock recording ${id}.jsonl line ${i + 1} is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  });
  const meta =
    records[0]?.type === 'meta'
      ? (records[0] as MockRecordingMeta)
      : ({ type: 'meta' } as MockRecordingMeta);
  const events = records.filter((r): r is MockEvent => r.type !== 'meta');
  return { id: meta.id ?? id, meta, events, path, method: 'random' };
}

function seededPick<T>(arr: T[], seed?: string): T | null {
  if (arr.length === 0) return null;
  if (!seed) return arr[Math.floor(Math.random() * arr.length)] ?? null;
  const h = parseInt(
    createHash('sha256').update(seed).digest('hex').slice(0, 12),
    16,
  );
  return arr[h % arr.length] ?? null;
}

/**
 * Resolve the recording to replay from NEUMA_MOCK_* env. A set-but-unmatched
 * NEUMA_MOCK_TRACE / NEUMA_MOCK_POOL throws rather than silently falling
 * through to a random trace — a typo must not quietly poison a test.
 */
export function pickRecording(
  opts: { trace?: string } = {},
): LoadedRecording | null {
  const dir = recordingsDir();
  const ids = listTraceIds(dir);
  if (ids.length === 0) return null;

  // Explicit per-call trace (e.g. config.model) wins over the env so
  // concurrent mock tasks can replay different traces without racing on
  // a shared process.env.
  const fixed = opts.trace || process.env.NEUMA_MOCK_TRACE;
  if (fixed) {
    const hit =
      ids.find((id) => id === fixed) ?? ids.find((id) => id.startsWith(fixed));
    if (!hit) {
      throw new Error(
        `NEUMA_MOCK_TRACE="${fixed}" matched no recording in ${dir}. ` +
          `Available: ${ids.join(', ') || '(none)'}.`,
      );
    }
    return { ...parseRecording(dir, hit), method: 'fixed' };
  }

  const pool = process.env.NEUMA_MOCK_POOL;
  if (pool) {
    const colon = pool.indexOf(':');
    const dim = colon >= 0 ? pool.slice(0, colon) : null;
    const value = colon >= 0 ? pool.slice(colon + 1) : null;
    const candidates = ids.filter((id) => {
      const { meta } = parseRecording(dir, id);
      const tags = meta.tags ?? [];
      if (dim === 'agent') return meta.agent === value;
      if (dim === 'outcome') return meta.outcome === value;
      if (dim === 'skill') return tags.includes(`skill:${value}`);
      return tags.includes(pool) || meta.agent === pool;
    });
    if (candidates.length === 0) {
      throw new Error(
        `NEUMA_MOCK_POOL="${pool}" matched no recording in ${dir}. ` +
          `Shapes: agent:<name>, outcome:<succeeded|failed|errored>, skill:<name>, or a bare tag.`,
      );
    }
    const picked = seededPick(candidates, process.env.NEUMA_MOCK_SEED)!;
    return { ...parseRecording(dir, picked), method: 'pool' };
  }

  const picked = seededPick(ids, process.env.NEUMA_MOCK_SEED)!;
  return { ...parseRecording(dir, picked), method: 'random' };
}
