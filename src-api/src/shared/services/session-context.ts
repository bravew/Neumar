/**
 * Per-turn session context propagated via `AsyncLocalStorage`.
 *
 * In-process MCP tools (e.g. the media-generation server) run in the parent
 * Node process, so `process.cwd()` is the API server's cwd — not the channel
 * workspace the agent is operating in. `getSessionWorkDir()` lets tools
 * resolve the correct per-turn workDir so generated files land somewhere
 * the channel-manager's post-run file scan can find them.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface SessionContext {
  /** Absolute path to the channel's workspace directory for this turn. */
  workDir: string;
  /** Agent session id — handy for logs. */
  sessionId?: string;
  /**
   * Per-user env overrides resolved at the channel layer (e.g. Slack App
   * Home PATs). In-process MCP tools read these at call time so a user's
   * key beats the global config — threading credentials only through the
   * SDK child env misses the in-process tool handlers entirely.
   */
  userCredentials?: Record<string, string>;
  /** Active Video Mode project id for request-scoped video MCP tools. */
  videoProjectId?: string;
  /** Currently selected Video Mode scene id, if the UI supplied one. */
  selectedSceneId?: string;
  /** Active Video Mode aspect ratio, e.g. "16:9" or "9:16". */
  aspectRatio?: string;
  /** Selected transcript range supplied by the Video Mode UI, if any. */
  transcriptSelection?: {
    sceneId?: string;
    clipId?: string;
    startMs: number;
    endMs: number;
    text: string;
  };
  /** Current Video Mode timeline/playhead selection supplied by the UI. */
  editorSelection?: {
    playheadMs?: number;
    selectedClipIds?: string[];
    previewFrame?: {
      atMs: number;
      sceneId?: string;
      clipId?: string;
      aspectRatio?: string;
      source: 'timeline-preview';
    };
    activePanel?: {
      kind: 'clip-inspector';
      clipId: string;
      tab?: string;
    };
  };
  /**
   * Override for where the media MCP server writes generated images / videos.
   * Default behavior in media-server.ts is `<workDir>/output`, which is
   * shared with final renders. Video Mode sets this to the project's
   * `assets/` dir so generated source media lands in the library directly.
   */
  mediaOutputDir?: string;
}

const storage = new AsyncLocalStorage<SessionContext>();

/** Active session's workDir, or undefined when outside a turn. */
export function getSessionWorkDir(): string | undefined {
  return storage.getStore()?.workDir;
}

/** Active session context, or undefined when outside a turn. */
export function getSessionContext(): SessionContext | undefined {
  return storage.getStore();
}

/**
 * Resolve an env-var-style key with per-turn precedence:
 *
 *   1. `SessionContext.userCredentials[key]` — Slack-Home PAT for the
 *      Slack user driving this run, if any.
 *   2. `process.env[key]` — server-wide default.
 *
 * Use this instead of `process.env.<KEY>` from any in-process consumer
 * (MCP tool handler, media-generation adapter, etc.) so per-user tokens
 * aren't lost. The SDK *child* process gets the same value via
 * `buildEnvConfig`, so child-side tools (`gh`, `curl`, etc.) keep
 * working without changes.
 */
export function getRunEnv(key: string): string | undefined {
  return storage.getStore()?.userCredentials?.[key] ?? process.env[key];
}

/**
 * Bind a session context to every `.next()` call of an async iterable.
 *
 * `AsyncLocalStorage.run` only covers the initial synchronous call; each
 * generator step an outer consumer pulls runs on a fresh promise chain and
 * loses context. Re-entering the store on every yield boundary keeps MCP
 * tool handlers — invoked by the SDK during any given step — inside the
 * right workDir for the full lifetime of the stream.
 */
/**
 * Run a one-shot async function inside a session context. The generator
 * `withSessionContext` is for streaming agent runs; this is for a discrete
 * call that needs the same ambient context — e.g. the loopback MCP bridge
 * serving a single tool request on behalf of a subprocess runtime, where the
 * in-process server reads `getSessionContext()` for its output dir.
 */
export function runWithSessionContext<T>(
  ctx: SessionContext,
  fn: () => Promise<T> | T,
): Promise<T> {
  return Promise.resolve(storage.run(ctx, fn));
}

export async function* withSessionContext<T>(
  ctx: SessionContext,
  source: AsyncIterable<T>,
): AsyncGenerator<T> {
  const iter = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const { value, done } = await storage.run(ctx, () => iter.next());
      if (done) return;
      yield value;
    }
  } finally {
    if (typeof iter.return === 'function') {
      // Swallow cleanup errors — they would otherwise replace the original
      // error that triggered the early exit.
      try {
        await storage.run(ctx, () => iter.return!(undefined));
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
