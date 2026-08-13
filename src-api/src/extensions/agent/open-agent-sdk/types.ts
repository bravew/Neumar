/**
 * Open Agent SDK type re-exports and internal helpers.
 *
 * Centralizes SDK type imports so the rest of the adapter only
 * depends on this file — isolating us from SDK type changes.
 */

export type {
  SDKMessage,
  SDKAssistantMessage,
  SDKToolResultMessage,
  SDKResultMessage,
  SDKPartialMessage,
  TokenUsage,
  ContentBlock,
  AgentOptions as SdkAgentOptions,
  AgentDefinition as SdkAgentDefinition,
  ThinkingConfig as SdkThinkingConfig,
  CanUseToolFn as SdkCanUseToolFn,
  CanUseToolResult as SdkCanUseToolResult,
  ToolDefinition as SdkToolDefinition,
  McpServerConfig as SdkMcpServerConfig,
  PermissionMode as SdkPermissionMode,
} from '@codeany/open-agent-sdk';

/**
 * Detect the upstream LLM provider from a model name.
 * Used for usage logging — maps model ID to provider label.
 */
export function detectProvider(model?: string): string {
  if (!model) return 'anthropic';
  if (model.startsWith('claude-')) return 'anthropic';
  if (
    model.startsWith('gpt-') ||
    model.startsWith('o1-') ||
    model.startsWith('o3-') ||
    model.startsWith('o4-')
  )
    return 'openai';
  if (model.startsWith('deepseek-')) return 'deepseek';
  if (model.startsWith('qwen-') || model.startsWith('qwq-')) return 'qwen';
  if (model.startsWith('mistral-') || model.startsWith('codestral-'))
    return 'mistral';
  return 'openai-compat';
}
