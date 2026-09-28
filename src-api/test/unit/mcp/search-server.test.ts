import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEARCH_TOOL_NAMES, searchTools } from '@/shared/mcp/search-server';
import { search } from '@/shared/services/search';
import { RESEARCH_TOOL_FLAG } from '@/shared/services/search/feature-flags';

import { toolResultText } from '../../helpers/tool-result-text';

vi.mock('@/shared/db/operations', () => ({
  getSetting: vi.fn(() => undefined),
}));

vi.mock('@/shared/services/search', () => ({
  listProviders: vi.fn(() => []),
  search: vi.fn(),
}));

describe('search MCP server', () => {
  beforeEach(() => {
    vi.mocked(search).mockReset();
    vi.stubEnv(RESEARCH_TOOL_FLAG, '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes a research tool', () => {
    expect(SEARCH_TOOL_NAMES).toContain('research');
  });

  it('maps quick research to a 5 result search with source domains', async () => {
    vi.mocked(search).mockResolvedValueOnce({
      query: 'vite latest',
      provider: 'brave',
      latencyMs: 42,
      cached: false,
      results: [
        {
          title: 'Vite',
          url: 'https://vite.dev/',
          snippet: 'Next generation frontend tooling.',
          source: 'brave',
        },
      ],
    });

    const research = searchTools.find((tool) => tool.name === 'research');
    expect(research).toBeDefined();

    const result = await research!.handler(
      {
        query: 'vite latest',
        depth: 'quick',
        sources: ['https://vite.dev/guide/', 'docs.example.com/path'],
      } as never,
      {},
    );

    expect(search).toHaveBeenCalledWith({
      query: 'vite latest',
      maxResults: 5,
      includeDomains: ['vite.dev', 'docs.example.com'],
    });
    expect(result.content[0]?.type).toBe('text');
    expect(toolResultText(result)).toContain('Research results');
    expect(toolResultText(result)).toContain('https://vite.dev/');
    expect(toolResultText(result)).toContain('excerptSha256=sha256:');
  });

  it('maps thorough research to a 10 result search', async () => {
    vi.mocked(search).mockResolvedValueOnce({
      query: 'react 19',
      provider: 'exa',
      latencyMs: 21,
      cached: true,
      results: [],
    });

    const research = searchTools.find((tool) => tool.name === 'research');
    await research!.handler(
      { query: 'react 19', depth: 'thorough', sources: undefined } as never,
      {},
    );

    expect(search).toHaveBeenCalledWith({
      query: 'react 19',
      maxResults: 10,
      includeDomains: undefined,
    });
  });

  it('blocks research calls when the feature flag is disabled', async () => {
    vi.stubEnv(RESEARCH_TOOL_FLAG, '');

    const research = searchTools.find((tool) => tool.name === 'research');
    const result = await research!.handler({ query: 'react 19' } as never, {});

    expect(search).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toContain('Research is disabled');
  });
});
