/**
 * MCP Shim Types
 *
 * Provider-agnostic type definitions for bridging MCP tools
 * to non-Claude agent providers.
 */

/** Provider-agnostic tool definition — the universal format */
export interface GenericToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

/** A tool call from the provider (any format, normalized) */
export interface GenericToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A tool result to send back to the provider */
export interface GenericToolResult {
  toolCallId: string;
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string }
      >;
  isError?: boolean;
}

/** Shim configuration per provider */
export interface McpShimConfig {
  /** Which MCP servers to load (null = all configured) */
  serverNames?: string[];
  /** Tool name prefix to avoid collisions (e.g., 'mcp_google_') */
  toolNamePrefix?: string;
  /** Max concurrent tool calls */
  maxConcurrentCalls?: number;
}

// ============================================================================
// OpenAI Format Types (for format converters)
// ============================================================================

export interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// ============================================================================
// Gemini Format Types (for format converters)
// ============================================================================

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}
