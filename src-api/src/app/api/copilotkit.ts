import { HttpAgent } from '@ag-ui/client';
import { CopilotRuntime } from '@copilotkit/runtime';
import {
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from '@copilotkit/runtime/v2';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CopilotKitRoute');

/**
 * CopilotKit runtime proxy.
 *
 * Routes CopilotKit frontend requests to our existing AG-UI endpoint.
 * `createCopilotEndpoint` returns a Hono sub-app that handles:
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

const runtime = new CopilotRuntime({
  agents: {
    // Register as 'default' — CopilotKit's DEFAULT_AGENT_ID is 'default',
    // used during runtime sync and as fallback when agentId is omitted
    default: new HttpAgent({
      url: aguiUrl,
      agentId: 'default',
    }),
  },
  // InMemoryAgentRunner's process-wide store keeps isRunning=true if a
  // previous run never completed (page refresh, client disconnect, SSE hang).
  // The default "throw" behavior then rejects every later run on that thread
  // with "Thread already running". "supersede" aborts the stale run and
  // starts the new one, which is the recovery this proxy needs.
  runner: new InMemoryAgentRunner({ onConcurrentRun: 'supersede' }),
});

// createCopilotEndpoint returns a Hono sub-app with multi-route REST endpoints:
//   GET  /copilotkit/info                    — agent discovery
//   POST /copilotkit/agent/:agentId/run      — start agent run (SSE stream)
//   POST /copilotkit/agent/:agentId/connect  — long-lived connection
//   POST /copilotkit/agent/:agentId/stop/:threadId — abort run
export const copilotKitRoutes = createCopilotEndpoint({
  runtime: runtime.instance,
  basePath: '/copilotkit',
});
