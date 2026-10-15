import { describe, expect, it } from 'vitest';

import { builtinAgentPlugins } from '@/core/agent';

/**
 * `supportsMcp` is display-only metadata: `getWithMcp()` has no caller, and the
 * frontend renders its `MCP` / `MCP~` badges straight from the value. That makes
 * an inaccurate level a user-facing claim with nothing behind it.
 *
 * These assertions cover the two adapters verified during the #272 correction.
 * Both declared `shim`, but neither has any MCP path:
 *
 * - `openai-compat` — the agentic loop offers only the built-in file, shell,
 *   media and search tools from `openai-compat/tools.ts`.
 * - `gemini-local` — `executeGemini()` passes only the prompt, model and
 *   `--resume` to the CLI, and writes no MCP server config.
 *
 * `McpShim` (`core/agent/mcp-shim.ts`) is never instantiated outside its own
 * test, so no provider can truthfully claim the `shim` level today.
 */
const VERIFIED_NO_MCP = ['openai-compat', 'gemini-local'] as const;

describe('agent provider capability metadata', () => {
  it('reports no MCP support for adapters with no MCP path', () => {
    const mismatches: string[] = [];

    for (const type of VERIFIED_NO_MCP) {
      const plugin = builtinAgentPlugins.find((p) => p.metadata.type === type);
      if (!plugin) {
        mismatches.push(`${type}: not in builtinAgentPlugins`);
        continue;
      }
      if (plugin.metadata.supportsMcp !== 'none') {
        mismatches.push(
          `${type}: supportsMcp=${plugin.metadata.supportsMcp}, expected none`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('advertises the shim level for no provider, since nothing instantiates it', () => {
    const shimProviders = builtinAgentPlugins
      .filter((p) => p.metadata.supportsMcp === 'shim')
      .map((p) => p.metadata.type);

    expect(shimProviders).toEqual([]);
  });
});
