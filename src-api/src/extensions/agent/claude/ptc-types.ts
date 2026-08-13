/**
 * Types for Programmatic Tool Calling (PTC) integration.
 *
 * PTC allows Claude to write Python code that calls tools within a code
 * execution container, eliminating per-tool model round-trips.
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Simplified tool definition for the Anthropic Messages API */
export interface PTCToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /**
   * Concrete usage examples that teach Claude correct parameter patterns.
   * Improves accuracy for complex parameter handling (72% → 90% per Anthropic).
   * @see https://www.anthropic.com/engineering/advanced-tool-use
   */
  input_examples?: Record<string, unknown>[];
}

/** Handler that executes a tool and returns its text result */
export type ToolHandler = (input: unknown) => Promise<CallToolResult>;

/** Options for the PTC execution loop */
export interface PTCOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  maxTokens?: number;
  maxTurns?: number;
  containerId?: string;
  abortSignal?: AbortSignal;
  systemPrompt?: string;
  /** Called when a container ID is obtained (for lifecycle management) */
  onContainerId?: (containerId: string, expiresAt?: string) => void;
  /** Pre-created Anthropic client (avoids duplicate instantiation) */
  client?: Anthropic;
  /** Task ID for usage tracking (enables channel source tagging) */
  taskId?: string;
  /** Optional permission gate for locally dispatched MCP tool calls. */
  canUseTool?: (
    toolName: string,
    input: unknown,
    signal: AbortSignal | undefined,
    toolUseId?: string,
  ) => Promise<{ behavior: 'allow' | 'deny'; message?: string }>;
}
