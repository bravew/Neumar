/**
 * Shared CLI Adapter Utilities
 *
 * Common utilities for CLI-based agent adapters:
 * binary resolution, working directory validation, environment merging,
 * JSONL stream parsing, preflight checks, and process lifecycle management.
 */

export { resolveBinaryPath, assertBinaryExists } from './command-resolver';
export { validateCwd, normalizeCwd } from './cwd-validator';
export { mergeEnv, redactForLog } from './env-merger';
export { parseJsonlStream, normalizeToAgentMessage } from './jsonl-parser';
export { runPreflight, type PreflightConfig } from './preflight';
export { withTimeout, createCancellableProcess } from './timeout-cancel';
export { runCliProcess, type CliRunEvent, type CliRunSpec } from './spawn-run';
export {
  runHeadlessPrompt,
  type HeadlessPromptArgs,
  type HeadlessPromptRunResult,
  type HeadlessPromptRunSpec,
} from './headless-prompt-run';
export {
  formatCliConversationPrompt,
  PlainTextStreamParser,
  streamCliAgentTurn,
  type CliAgentTurnParams,
  type CliStreamParser,
} from './cli-agent-turn';
