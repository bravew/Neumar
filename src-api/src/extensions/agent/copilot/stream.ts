/**
 * GitHub Copilot CLI `--output-format json` JSONL parser.
 *
 * Copilot's schema uses dotted top-level types (`assistant.*`, `tool.*`,
 * `session.*`) with the payload under `data`; the terminal `result` event
 * carries usage/success at the top level. Mapping (ported from the Open
 * Design reference handler `_sample/open-design/apps/daemon/src/copilot-stream.ts`):
 *
 *   session.tools_updated      -> system init (model name)
 *   assistant.reasoning_delta  -> thinking
 *   assistant.message_delta    -> text
 *   tool.execution_start       -> tool_use
 *   tool.execution_complete    -> tool_result
 *   result                     -> result (usage) or error when success=false
 */

import type { AgentMessage } from '@/core/agent/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringifyToolResult(r: unknown): string {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  if (!isRecord(r)) return JSON.stringify(r);
  if (typeof r.content === 'string') return r.content;
  if (typeof r.detailedContent === 'string') return r.detailedContent;
  return JSON.stringify(r);
}

export class CopilotStreamParser {
  private buffer = '';
  sawText = false;
  sawError = false;

  *feed(chunk: string): Generator<AgentMessage> {
    this.buffer += chunk;
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (line) yield* this.handleLine(line);
    }
  }

  *flush(): Generator<AgentMessage> {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) yield* this.handleLine(rest);
  }

  private *handleLine(line: string): Generator<AgentMessage> {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      // Non-JSON stdout (login hints, warnings) — surface rather than drop.
      this.sawText = true;
      yield { type: 'text', content: `${line}\n` };
      return;
    }
    yield* this.handleEvent(obj);
  }

  private *handleEvent(obj: unknown): Generator<AgentMessage> {
    if (!isRecord(obj) || typeof obj.type !== 'string') return;
    const data = isRecord(obj.data) ? obj.data : {};

    switch (obj.type) {
      case 'session.tools_updated':
        if (typeof data.model === 'string') {
          yield { type: 'system', subtype: 'init', model: data.model };
        }
        return;

      case 'assistant.reasoning_delta':
        if (typeof data.deltaContent === 'string') {
          yield { type: 'thinking', content: data.deltaContent };
        }
        return;

      case 'assistant.message_delta':
        if (typeof data.deltaContent === 'string') {
          this.sawText = true;
          yield { type: 'text', content: data.deltaContent };
        }
        return;

      case 'tool.execution_start':
        yield {
          type: 'tool_use',
          id: typeof data.toolCallId === 'string' ? data.toolCallId : undefined,
          name: typeof data.toolName === 'string' ? data.toolName : 'tool',
          input: data.arguments,
        };
        return;

      case 'tool.execution_complete':
        yield {
          type: 'tool_result',
          toolUseId:
            typeof data.toolCallId === 'string' ? data.toolCallId : undefined,
          content: stringifyToolResult(data.result),
          isError: data.success === false,
        };
        return;

      case 'result': {
        // `result` puts usage / success at the top level. Missing exitCode
        // with `success: true` still counts as success.
        const usage = isRecord(obj.usage) ? obj.usage : undefined;
        const succeeded = obj.success === true || obj.exitCode === 0;
        if (!succeeded) {
          this.sawError = true;
          const message =
            typeof obj.error === 'string'
              ? obj.error
              : 'GitHub Copilot CLI run failed';
          yield { type: 'error', message, content: message };
          return;
        }
        yield {
          type: 'result',
          usage: usage
            ? {
                input_tokens:
                  typeof usage.inputTokens === 'number'
                    ? usage.inputTokens
                    : undefined,
                output_tokens:
                  typeof usage.outputTokens === 'number'
                    ? usage.outputTokens
                    : undefined,
              }
            : undefined,
          duration:
            usage && typeof usage.sessionDurationMs === 'number'
              ? usage.sessionDurationMs
              : undefined,
        };
        return;
      }

      default:
        return;
    }
  }
}
