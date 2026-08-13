import { vi } from 'vitest';

/**
 * Create a minimal mock MCP server config for testing.
 */
export function createMockMcpConfig(
  name: string = 'test-mcp',
): Record<string, unknown> {
  return {
    [name]: {
      command: 'echo',
      args: ['{}'],
    },
  };
}

/**
 * Create a vi mock for the MCP loader module.
 */
export function mockMcpLoader() {
  return vi.fn().mockResolvedValue({
    tools: [],
    resources: [],
    prompts: [],
  });
}
