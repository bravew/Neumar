/**
 * AskUserQuestion text-bridge for agent adapters without a native
 * AskUserQuestion tool. Used by Codex, HTTP-agent, OpenCode, Cursor, etc.
 *
 * Architecture
 * ------------
 * Claude's Agent SDK exposes `AskUserQuestion` as a built-in tool — the
 * model invokes it, the SDK pauses the turn via `canUseTool`, the host
 * resolves the promise with the user's answer, and the same turn
 * continues. The frontend (`useAgent.ts`, `TaskV2MessageBubbleAskUser.tsx`)
 * is wired around that native flow.
 *
 * Adapters routed through other agent runtimes (Codex CLI, raw HTTP, etc.)
 * don't have that built-in tool. To deliver the same UX without forking
 * the frontend, we ask the model to emit a fenced JSON block that those
 * adapters parse server-side and re-emit as a synthetic `tool_use`
 * AG-UI event with `name: 'AskUserQuestion'` — identical in shape to the
 * Claude path, so all downstream rendering, persistence, and HITL resume
 * logic is shared.
 *
 * Public surface
 * --------------
 * - `ASK_USER_QUESTION_INSTRUCTION` — system-prompt prefix.
 * - `ASK_USER_QUESTION_TOOL_NAME` — tool name string ('AskUserQuestion').
 * - `tryExtractAskUserQuestion(text)` — batch parser (Codex agent_message
 *   and renderable question-form blocks).
 * - `AskUserQuestionStreamFilter` — chunk-based parser (HTTP SSE, CLI stdout).
 * - `buildAskUserQuestionToolUse(payload, id?)` — synth event constructor.
 * - `validateAskUserQuestionPayload(raw)` — useful when an adapter ever
 *    gains a native tool channel and wants to validate the model's input
 *    directly against the canonical schema.
 *
 * Resume semantics
 * ----------------
 * After the user answers, the frontend
 * (`src/shared/hooks/useAgentActions.ts:handleSendMessage`) calls
 * `agent.runAgent(...)` only when `agent.isRunning === false`. Native
 * Claude path stays running (canUseTool returns the tool_result); text
 * bridge path ended its turn after emitting the fenced block, so a fresh
 * turn starts with the answer in the conversation history.
 */

export {
  ASK_USER_QUESTION_FENCE_LANG,
  ASK_USER_QUESTION_FENCE_RE,
  ASK_USER_QUESTION_INSTRUCTION,
  ASK_USER_QUESTION_TAG_NAMES,
  ASK_USER_QUESTION_TAG_RE,
  ASK_USER_QUESTION_TOOL_NAME,
} from './instruction';
export { buildAskUserQuestionToolUse } from './event';
export {
  tryExtractAskUserQuestion,
  validateAskUserQuestionPayload,
} from './parser';
export type {
  AskUserQuestion,
  AskUserQuestionOption,
  AskUserQuestionGate,
  AskUserQuestionPayload,
  AskUserQuestionPolicy,
} from './schema';
export { AskUserQuestionStreamFilter } from './stream';
