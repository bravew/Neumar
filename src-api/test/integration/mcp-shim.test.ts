import { describe, expect, it } from 'vitest';

import {
  fromGeminiToolCall,
  fromOpenAIToolCall,
  McpShim,
  toGeminiTools,
  toOpenAITools,
} from '@/core/agent/mcp-shim';
import type {
  GeminiFunctionCall,
  GenericToolDefinition,
  OpenAIToolCall,
} from '@/core/agent/mcp-shim-types';

import { defined } from '../helpers/defined';

const SAMPLE_TOOLS: GenericToolDefinition[] = [
  {
    name: 'search',
    description: 'Search the web',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
    },
  },
];
const searchTool = defined(SAMPLE_TOOLS[0], 'search tool');
const readFileTool = defined(SAMPLE_TOOLS[1], 'read_file tool');

describe('MCP Shim', () => {
  describe('McpShim', () => {
    it('getToolDefinitions returns registered tools', () => {
      const shim = new McpShim();
      shim.registerTool('google', searchTool);
      shim.registerTool('fs', readFileTool);

      const defs = shim.getToolDefinitions();
      expect(defs).toHaveLength(2);
      expect(defined(defs[0]).name).toBe('search');
      expect(defined(defs[1]).name).toBe('read_file');
    });

    it('executeTool returns isError for unknown tool names', async () => {
      const shim = new McpShim();
      const result = await shim.executeTool({
        id: 'call-1',
        name: 'nonexistent',
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(result.toolCallId).toBe('call-1');
    });

    it('executeTool routes to correct MCP server', async () => {
      const shim = new McpShim();
      shim.registerTool('google', searchTool);

      const result = await shim.executeTool({
        id: 'call-2',
        name: 'search',
        arguments: { query: 'test' },
      });
      expect(result.isError).toBeUndefined();
      expect(result.toolCallId).toBe('call-2');
    });

    it('toolNamePrefix correctly prefixes/strips tool names', () => {
      const shim = new McpShim({ toolNamePrefix: 'mcp_' });
      shim.registerTool('google', searchTool);

      const defs = shim.getToolDefinitions();
      expect(defined(defs[0]).name).toBe('mcp_search');
    });
  });

  describe('toOpenAITools', () => {
    it('converts GenericToolDefinition to OpenAI function calling format', () => {
      const result = toOpenAITools(SAMPLE_TOOLS);
      expect(result).toHaveLength(2);
      const openaiTool = defined(result[0]);
      expect(openaiTool.type).toBe('function');
      expect(openaiTool.function.name).toBe('search');
      expect(openaiTool.function.description).toBe('Search the web');
      expect(openaiTool.function.parameters).toEqual(searchTool.inputSchema);
    });
  });

  describe('toGeminiTools', () => {
    it('converts GenericToolDefinition to Gemini function declaration format', () => {
      const result = toGeminiTools(SAMPLE_TOOLS);
      expect(result).toHaveLength(2);
      const geminiTool = defined(result[0]);
      expect(geminiTool.name).toBe('search');
      expect(geminiTool.description).toBe('Search the web');
      expect(geminiTool.parameters).toEqual(searchTool.inputSchema);
    });
  });

  describe('fromOpenAIToolCall', () => {
    it('normalizes OpenAI tool call to GenericToolCall', () => {
      const openaiCall: OpenAIToolCall = {
        id: 'call-123',
        type: 'function',
        function: {
          name: 'search',
          arguments: '{"query":"hello"}',
        },
      };
      const result = fromOpenAIToolCall(openaiCall);
      expect(result.id).toBe('call-123');
      expect(result.name).toBe('search');
      expect(result.arguments).toEqual({ query: 'hello' });
    });
  });

  describe('fromGeminiToolCall', () => {
    it('normalizes Gemini function call to GenericToolCall', () => {
      const geminiCall: GeminiFunctionCall = {
        name: 'read_file',
        args: { path: '/tmp/test.txt' },
      };
      const result = fromGeminiToolCall(geminiCall, 'call-456');
      expect(result.id).toBe('call-456');
      expect(result.name).toBe('read_file');
      expect(result.arguments).toEqual({ path: '/tmp/test.txt' });
    });

    it('generates UUID when no id provided', () => {
      const geminiCall: GeminiFunctionCall = {
        name: 'search',
        args: { query: 'test' },
      };
      const result = fromGeminiToolCall(geminiCall);
      expect(result.id).toBeTruthy();
      expect(result.id.length).toBeGreaterThan(0);
    });
  });
});
