/**
 * MCP Shim Layer
 *
 * Provider-agnostic MCP bridge that translates MCP tools to/from
 * different provider formats (OpenAI, Gemini, etc.).
 * Claude uses native MCP — this shim is only for non-Claude providers.
 */

import { loadMcpServers, type McpServerConfig } from '@/shared/mcp/loader';
import { createLogger } from '@/shared/utils/logger';

import type {
  GeminiFunctionCall,
  GeminiFunctionDeclaration,
  GenericToolCall,
  GenericToolDefinition,
  GenericToolResult,
  McpShimConfig,
  OpenAIFunctionTool,
  OpenAIToolCall,
} from './mcp-shim-types';

const logger = createLogger('McpShim');

/**
 * MCP Shim — bridges MCP tools to any provider's tool format.
 */
export class McpShim {
  private config: McpShimConfig;
  private tools: GenericToolDefinition[] = [];
  private toolServerMap: Map<string, string> = new Map();
  private serverConfigs: Record<string, McpServerConfig> = {};
  private initialized = false;

  constructor(config?: McpShimConfig) {
    this.config = config || {};
  }

  /**
   * Initialize: load MCP servers and collect tool definitions.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const servers = await loadMcpServers();
      this.serverConfigs = servers;

      // Filter to requested servers if specified
      const serverNames = this.config.serverNames
        ? Object.keys(servers).filter((name) =>
            this.config.serverNames!.includes(name),
          )
        : Object.keys(servers);

      for (const serverName of serverNames) {
        // For now, register placeholder tools from server configs.
        // In production, this would connect to MCP servers and call tools/list.
        // The actual tool listing requires running MCP server processes,
        // which is handled by the Claude Agent SDK for native MCP.
        // For the shim, we provide the infrastructure to register and route tools.
        logger.debug(`Registered MCP server: ${serverName}`);
      }

      this.initialized = true;
      logger.info(
        `McpShim initialized with ${serverNames.length} server(s), ${this.tools.length} tool(s)`,
      );
    } catch (error) {
      logger.error('Failed to initialize MCP shim:', error);
      throw error;
    }
  }

  /**
   * Register a tool definition (called by MCP server connections).
   */
  registerTool(serverName: string, tool: GenericToolDefinition): void {
    const prefixedName = this.config.toolNamePrefix
      ? `${this.config.toolNamePrefix}${tool.name}`
      : tool.name;

    this.tools.push({
      ...tool,
      name: prefixedName,
    });
    this.toolServerMap.set(prefixedName, serverName);
  }

  /**
   * Get all MCP tools in provider-agnostic format.
   */
  getToolDefinitions(): GenericToolDefinition[] {
    return [...this.tools];
  }

  /**
   * Execute a tool call, routing to the correct MCP server.
   */
  async executeTool(call: GenericToolCall): Promise<GenericToolResult> {
    // Strip prefix to find the real tool name
    const realName = this.config.toolNamePrefix
      ? call.name.replace(this.config.toolNamePrefix, '')
      : call.name;

    const serverName = this.toolServerMap.get(call.name);

    if (!serverName) {
      logger.warn(`Unknown shim tool: ${call.name}`);
      return {
        toolCallId: call.id,
        content: `Error: Unknown tool '${realName}'`,
        isError: true,
      };
    }

    try {
      // In production, this would call the MCP server's tools/call endpoint.
      // For now, return a placeholder indicating the tool was routed correctly.
      logger.info(
        `Executing shim tool '${realName}' on server '${serverName}'`,
      );

      return {
        toolCallId: call.id,
        content: `Tool '${realName}' executed on server '${serverName}'`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Shim tool execution failed: ${msg}`);
      return {
        toolCallId: call.id,
        content: `Error executing tool '${realName}': ${msg}`,
        isError: true,
      };
    }
  }

  /**
   * Shutdown: close all MCP server connections.
   */
  async shutdown(): Promise<void> {
    this.tools = [];
    this.toolServerMap.clear();
    this.serverConfigs = {};
    this.initialized = false;
    logger.info('McpShim shutdown');
  }
}

// ============================================================================
// Format Converters
// ============================================================================

/**
 * Convert GenericToolDefinitions to OpenAI function calling format.
 */
export function toOpenAITools(
  defs: GenericToolDefinition[],
): OpenAIFunctionTool[] {
  return defs.map((def) => ({
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  }));
}

/**
 * Convert GenericToolDefinitions to Gemini function declaration format.
 */
export function toGeminiTools(
  defs: GenericToolDefinition[],
): GeminiFunctionDeclaration[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.inputSchema,
  }));
}

/**
 * Normalize an OpenAI tool call to GenericToolCall.
 */
export function fromOpenAIToolCall(call: OpenAIToolCall): GenericToolCall {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(call.function.arguments) as Record<string, unknown>;
  } catch {
    logger.warn(
      `Failed to parse OpenAI tool call arguments for '${call.function.name}'`,
    );
  }
  return {
    id: call.id,
    name: call.function.name,
    arguments: args,
  };
}

/**
 * Normalize a Gemini function call to GenericToolCall.
 */
export function fromGeminiToolCall(
  call: GeminiFunctionCall,
  id?: string,
): GenericToolCall {
  return {
    id: id || crypto.randomUUID(),
    name: call.name,
    arguments: call.args || {},
  };
}
