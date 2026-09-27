/**
 * Codex stream mapper
 *
 * Maps the Codex SDK `ThreadEvent` item lifecycle (`item.started` →
 * `item.updated`* → `item.completed`) onto AgentMessages. One instance is
 * created per turn because the lifecycle is stateful: a tool call is announced
 * when its item starts, progress is reported while it updates, and the result
 * is attached when it completes.
 *
 * Partial agent text and still-running tool calls are flushed when the turn
 * fails, errors, or is interrupted, so the user keeps whatever output Codex
 * produced before the turn ended (Codex CLI 0.156 behavior).
 */

import { existsSync } from 'fs';
import { join, resolve as resolvePath } from 'path';

import type {
  CommandExecutionItem,
  McpToolCallItem,
  ThreadEvent,
  ThreadItem,
  TodoListItem,
} from '@openai/codex-sdk';

import {
  buildAskUserQuestionToolUse,
  tryExtractAskUserQuestion,
} from '@/core/agent/ask-user-question';
import type { AgentMessage } from '@/core/agent/types';

import { defendToolOutput } from '@/shared/security/tool-output-defense';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Codex');

/**
 * Upper bound on the live command output carried by one `tool_progress`
 * message. Progress is a display aid; the full output arrives with the
 * `tool_result` when the command completes.
 */
export const LIVE_OUTPUT_TAIL_CHARS = 4000;

/** Output recorded on a tool call that was still running when the turn ended. */
export const INTERRUPTED_TOOL_OUTPUT = 'Interrupted before completion';

/** Claude `TodoWrite` todo shape; the frontend already renders this tool. */
interface TodoWriteTodo {
  content: string;
  status: 'pending' | 'completed';
  activeForm: string;
}

/**
 * Render an MCP tool call's result/error into the human-visible text shown
 * in the tool-result panel. Codex's internal context still receives the raw
 * structured payload — this is only for the UI stream.
 */
function formatMcpToolOutput(item: McpToolCallItem): string {
  if (item.error?.message) return `Error: ${item.error.message}`;
  const blocks = item.result?.content ?? [];
  if (blocks.length === 0) {
    return item.status === 'failed'
      ? 'Tool call failed'
      : 'Tool call completed';
  }
  const parts: string[] = [];
  for (const block of blocks as Array<Record<string, unknown>>) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'image' && typeof block.mimeType === 'string') {
      parts.push(`[image: ${block.mimeType}]`);
    } else if (block.type === 'audio' && typeof block.mimeType === 'string') {
      parts.push(`[audio: ${block.mimeType}]`);
    } else {
      parts.push(JSON.stringify(block));
    }
  }
  return parts.join('\n');
}

/**
 * Codex runs its own internal tool loop (re-entry happens inside the codex
 * process), so this is a display-redaction layer. BLOCK still rewrites the
 * displayed text so the user is not shown raw injected content harvested
 * through the adapter boundary.
 */
function defendCommandOutput(toolUseId: string, content: string) {
  return defendToolOutput({
    source: { adapter: 'codex', toolName: 'Bash', toolUseId },
    content,
    riskHint: 'high',
  });
}

function toTodoWriteInput(item: TodoListItem): { todos: TodoWriteTodo[] } {
  return {
    todos: item.items.map((todo) => ({
      content: todo.text,
      // Codex reports only a completed flag, so there is no in-progress state.
      status: todo.completed ? 'completed' : 'pending',
      activeForm: todo.text,
    })),
  };
}

function formatTodoList(item: TodoListItem): string {
  return item.items
    .map((todo) => `${todo.completed ? '[x]' : '[ ]'} ${todo.text}`)
    .join('\n');
}

export class CodexStreamMapper {
  /** Codex item id → tool_use id for tool calls announced but not completed. */
  private readonly openTools = new Map<string, string>();
  /** Codex item id → latest partial agent text not yet emitted. */
  private readonly pendingText = new Map<string, string>();
  /** Codex item id → reasoning text already emitted. */
  private readonly emittedReasoning = new Map<string, string>();
  /** Codex item id → command output length already reported as progress. */
  private readonly reportedOutputLength = new Map<string, number>();
  /** Codex item id → last to-do snapshot emitted as a TodoWrite call. */
  private readonly emittedTodos = new Map<string, string>();

  /** @param cwd - Working directory for resolving relative file paths */
  constructor(private readonly cwd: string) {}

  /**
   * Map one item, turn-failure, or stream-error event. Thread lifecycle and
   * usage events are handled by the adapter and yield nothing here.
   */
  *map(event: ThreadEvent): Iterable<AgentMessage> {
    switch (event.type) {
      case 'item.started':
      case 'item.updated':
        yield* this.mapItemProgress(event.item);
        break;
      case 'item.completed':
        yield* this.mapItemCompleted(event.item);
        break;
      case 'error': {
        const errEvent = event as unknown as {
          error?: { message?: string; code?: string };
          message?: string;
        };
        const errMsg =
          errEvent.error?.message ?? errEvent.message ?? 'Codex error';
        logger.error('Codex SDK error event', {
          error: errEvent.error ?? errEvent.message,
          code: errEvent.error?.code,
        });
        yield* this.finish();
        yield { type: 'error', message: errMsg };
        break;
      }
      case 'turn.failed':
        yield* this.finish();
        yield {
          type: 'error',
          message: event.error?.message ?? 'Codex turn failed',
        };
        break;
    }
  }

  /**
   * Flush state left by a turn that ended before its items completed: emit
   * partial agent text and close still-running tool calls as errors. Call on
   * interrupts and on stream exits; it yields nothing after a clean turn.
   */
  *finish(): Iterable<AgentMessage> {
    for (const text of this.pendingText.values()) {
      if (text) yield { type: 'text', content: text };
    }
    for (const toolUseId of this.openTools.values()) {
      yield {
        type: 'tool_result',
        toolUseId,
        output: INTERRUPTED_TOOL_OUTPUT,
        isError: true,
      };
    }
    this.pendingText.clear();
    this.openTools.clear();
    this.emittedReasoning.clear();
    this.reportedOutputLength.clear();
    this.emittedTodos.clear();
  }

  private *mapItemProgress(item: ThreadItem): Iterable<AgentMessage> {
    switch (item.type) {
      case 'agent_message':
        // Held back until completion: the text may carry an AskUserQuestion
        // block that must be parsed whole. Flushed by finish() if the turn ends.
        this.pendingText.set(item.id, item.text);
        break;
      case 'reasoning':
        yield* this.emitReasoning(item.id, item.text);
        break;
      case 'command_execution':
        yield* this.announceTool(item.id, 'Bash', { command: item.command });
        yield* this.emitCommandProgress(item);
        break;
      case 'mcp_tool_call':
        yield* this.announceTool(
          item.id,
          item.tool,
          item.arguments as Record<string, unknown>,
        );
        break;
      case 'web_search':
        yield* this.announceTool(item.id, 'WebSearch', { query: item.query });
        break;
      case 'todo_list':
        yield* this.emitTodoList(item);
        break;
    }
  }

  private *mapItemCompleted(item: ThreadItem): Iterable<AgentMessage> {
    switch (item.type) {
      case 'agent_message': {
        this.pendingText.delete(item.id);
        if (!item.text) break;
        const askUser = tryExtractAskUserQuestion(item.text);
        if (askUser) {
          // Bridge to the existing AskUserQuestion UI: emit a synthetic tool_use
          // event so `useAgent.ts` pauses the run and renders QuestionInput.
          yield buildAskUserQuestionToolUse(askUser);
          break;
        }
        yield { type: 'text', content: item.text };
        break;
      }
      case 'reasoning':
        yield* this.emitReasoning(item.id, item.text);
        this.emittedReasoning.delete(item.id);
        break;
      case 'command_execution': {
        const toolUseId = yield* this.announceTool(item.id, 'Bash', {
          command: item.command,
        });
        this.openTools.delete(item.id);
        this.reportedOutputLength.delete(item.id);
        yield this.commandResult(toolUseId, item);
        break;
      }
      case 'file_change':
        for (const change of item.changes) {
          // Resolve to absolute path and use file_path (frontend expects this key)
          const absPath = change.path.startsWith('/')
            ? change.path
            : resolvePath(join(this.cwd, change.path));
          // Only emit if the file actually exists (avoids phantom entries)
          if (existsSync(absPath)) {
            const fileToolId = crypto.randomUUID();
            yield {
              type: 'tool_use',
              name: change.kind === 'add' ? 'Write' : 'Edit',
              id: fileToolId,
              input: { file_path: absPath },
            };
            yield {
              type: 'tool_result',
              toolUseId: fileToolId,
              output: `${change.kind === 'add' ? 'Created' : 'Modified'}: ${absPath}`,
              isError: false,
            };
          }
        }
        break;
      case 'web_search': {
        const toolUseId = yield* this.announceTool(item.id, 'WebSearch', {
          query: item.query,
        });
        this.openTools.delete(item.id);
        yield {
          type: 'tool_result',
          toolUseId,
          output: 'Search completed',
          isError: false,
        };
        break;
      }
      case 'mcp_tool_call': {
        const toolUseId = yield* this.announceTool(
          item.id,
          item.tool,
          item.arguments as Record<string, unknown>,
        );
        this.openTools.delete(item.id);
        yield {
          type: 'tool_result',
          toolUseId,
          output: formatMcpToolOutput(item),
          isError: item.status === 'failed',
        };
        break;
      }
      case 'todo_list':
        yield* this.emitTodoList(item);
        this.emittedTodos.delete(item.id);
        break;
    }
  }

  /**
   * Emit the tool_use for an item once, on its first event, and return the
   * tool_use id that later progress and results attach to.
   */
  private *announceTool(
    itemId: string,
    name: string,
    input: Record<string, unknown>,
  ): Generator<AgentMessage, string> {
    const existing = this.openTools.get(itemId);
    if (existing) return existing;
    const toolUseId = crypto.randomUUID();
    this.openTools.set(itemId, toolUseId);
    yield { type: 'tool_use', name, id: toolUseId, input };
    return toolUseId;
  }

  /**
   * Codex sends the full reasoning summary on every event; emit it again only
   * when it changed. Cumulative content matches the Claude adapter's thinking
   * stream, whose consumers keep the latest message.
   */
  private *emitReasoning(itemId: string, text: string): Iterable<AgentMessage> {
    if (!text || this.emittedReasoning.get(itemId) === text) return;
    this.emittedReasoning.set(itemId, text);
    yield { type: 'thinking', content: text };
  }

  private *emitCommandProgress(
    item: CommandExecutionItem,
  ): Iterable<AgentMessage> {
    const output = item.aggregated_output;
    const toolUseId = this.openTools.get(item.id);
    if (!output || !toolUseId) return;
    if (output.length <= (this.reportedOutputLength.get(item.id) ?? 0)) return;
    this.reportedOutputLength.set(item.id, output.length);
    const defended = defendCommandOutput(
      toolUseId,
      output.slice(-LIVE_OUTPUT_TAIL_CHARS),
    );
    yield {
      type: 'tool_progress',
      id: toolUseId,
      name: 'Bash',
      content: defended.displayContent,
      isProgress: true,
    };
  }

  private commandResult(
    toolUseId: string,
    item: CommandExecutionItem,
  ): AgentMessage {
    const failed =
      item.status === 'failed' ||
      (item.exit_code !== undefined && item.exit_code !== 0);
    if (!item.aggregated_output) {
      return { type: 'tool_result', toolUseId, output: '', isError: failed };
    }
    const defended = defendCommandOutput(toolUseId, item.aggregated_output);
    return {
      type: 'tool_result',
      toolUseId,
      output: defended.displayContent,
      isError: failed || defended.verdict === 'BLOCK',
      security: {
        verdict: defended.verdict,
        source: 'codex',
        payloadHash: defended.audit.payloadHash,
        redactedSnippet: defended.redactedSnippet,
        scores: defended.scores as Record<string, number>,
      },
    };
  }

  /**
   * Each to-do snapshot becomes one completed TodoWrite call, matching how
   * Claude reports every plan revision as a separate TodoWrite tool call.
   */
  private *emitTodoList(item: TodoListItem): Iterable<AgentMessage> {
    const snapshot = formatTodoList(item);
    if (this.emittedTodos.get(item.id) === snapshot) return;
    this.emittedTodos.set(item.id, snapshot);
    const toolUseId = crypto.randomUUID();
    yield {
      type: 'tool_use',
      name: 'TodoWrite',
      id: toolUseId,
      input: toTodoWriteInput(item),
    };
    yield {
      type: 'tool_result',
      toolUseId,
      output: snapshot,
      isError: false,
    };
  }
}
