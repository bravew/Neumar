import { HttpAgent } from '@ag-ui/client';
import { CopilotRuntime } from '@copilotkit/runtime';
import { createCopilotEndpoint } from '@copilotkit/runtime/v2';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CopilotKitRoute');

/**
 * CopilotKit runtime proxy.
 *
 * Routes CopilotKit frontend requests to our existing AG-UI endpoint.
 * `createCopilotEndpointSingleRoute` returns a Hono sub-app that handles:
 *   - Agent run requests (SSE stream)
 *   - Agent discovery
 *   - Run abort
 *
 * Frontend: CopilotKitProvider(runtimeUrl="/copilotkit") → useAgent → HttpAgent
 * Backend:  CopilotRuntime → HttpAgent → POST /ag-ui/run (loopback 127.0.0.1)
 */
function getAguiUrl(): string {
  // Match main server port resolution: process.env.PORT || 5126 (dev default)
  const port = process.env.PORT || '5126';
  return `http://127.0.0.1:${port}/ag-ui/run`;
}

const aguiUrl = getAguiUrl();
logger.info(`CopilotKit runtime proxying to AG-UI at ${aguiUrl}`);

// ── Stale thread reset ──────────────────────────────────────────────────
// InMemoryAgentRunner's global store retains isRunning=true if a previous run
// didn't complete (page refresh, client disconnect, SSE hang).  Subsequent
// run() calls for the same threadId throw "Thread already running".
// We reset stale state before each request via onBeforeRequest middleware.
//
// IMPORTANT: this key must match the runner's actual symbol exactly. The
// runner declares `Symbol.for("@copilotkit/runtime/in-memory-store")` —
// `Symbol.for` is keyed by string identity, so any typo (e.g.
// "@copilotkitnext/...") silently reads a different / empty store and the
// reset becomes a no-op.

const GLOBAL_STORE_KEY = Symbol.for('@copilotkit/runtime/in-memory-store');

type ThreadStore = {
  isRunning: boolean;
  currentRunId: string | null;
  agent: { abortRun: () => void } | null;
  runSubject: { complete: () => void } | null;
  stopRequested: boolean;
  currentEvents: unknown[] | null;
};

function resetStaleThread(threadId: string): void {
  const data = (
    globalThis as Record<symbol, { stores?: Map<string, ThreadStore> }>
  )[GLOBAL_STORE_KEY];
  const store = data?.stores?.get(threadId);
  if (!store?.isRunning) return;

  logger.warn('Resetting stale CopilotKit thread', { threadId });

  if (store.agent) {
    try {
      store.agent.abortRun();
    } catch {
      // Best-effort abort
    }
  }
  if (store.runSubject) {
    try {
      store.runSubject.complete();
    } catch {
      // Best-effort observable cleanup
    }
  }

  store.isRunning = false;
  store.currentRunId = null;
  store.agent = null;
  store.runSubject = null;
  store.stopRequested = false;
  store.currentEvents = null;
}

const runtime = new CopilotRuntime({
  agents: {
    // Register as 'default' — CopilotKit's DEFAULT_AGENT_ID is 'default',
    // used during runtime sync and as fallback when agentId is omitted
    default: new HttpAgent({
      url: aguiUrl,
      agentId: 'default',
    }),
  },
  middleware: {
    onBeforeRequest: ({ threadId }: { threadId?: string }) => {
      if (threadId) resetStaleThread(threadId);
    },
  },
} as ConstructorParameters<typeof CopilotRuntime>[0]);

// createCopilotEndpoint returns a Hono sub-app with multi-route REST endpoints:
//   GET  /copilotkit/info                    — agent discovery
//   POST /copilotkit/agent/:agentId/run      — start agent run (SSE stream)
//   POST /copilotkit/agent/:agentId/connect  — long-lived connection
//   POST /copilotkit/agent/:agentId/stop/:threadId — abort run
export const copilotKitRoutes = createCopilotEndpoint({
  runtime: runtime.instance,
  basePath: '/copilotkit',
});
