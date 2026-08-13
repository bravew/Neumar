/**
 * Pipeline Module — Barrel Exports
 *
 * Public API for the autonomous ticket-to-PR pipeline.
 * Internal implementation details (agents, CI, confidence, hooks, etc.)
 * are consumed within the pipeline folder and not re-exported.
 */

// ── Core pipeline lifecycle (used by index.ts, route handlers) ──
export {
  abort,
  cleanup,
  enqueue,
  getAll,
  getStatus,
  loadPersistedState,
  shutdownPipelines,
} from './pipeline';

// ── Types (used by routes and external callers) ──
export type { PipelineState, PipelineStatus } from './pipeline';

// ── Prompts types (used by figma-resolver) ──
export type {
  DesignContext,
  RepoContext,
  RepoInfo,
  TicketContext,
} from './prompts';

// ── Repo resolution (used by external callers) ──
export {
  resolveAllReposFromTicket,
  resolveRepoFromTicket,
} from './repo-resolver';
export type { RepoResolutionSource, ResolvedRepo } from './repo-resolver';

// ── Swarm task tracking (used externally for task management) ──
export {
  areChildrenComplete,
  createSwarmTask,
  getSwarmTask,
  getTaskChildren,
  linkTasks,
  updateSwarmTask,
} from './swarm-task';
export type { SwarmTask } from './swarm-task';

// ── Multi-repo decomposition ──
export { decomposeMultiRepoIssue } from './orchestrator';

// ── Budget tracking ──
export {
  checkBudget,
  getBudgetSummary,
  getTicketCost,
  recordTicketCost,
} from './budget';
