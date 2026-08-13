/**
 * Search MCP Server
 *
 * Inline MCP server that exposes provider-agnostic web search tools
 * to the AI agent. The agent calls these tools when it needs to search
 * the web for current information.
 *
 * Tools:
 *   - research           — Research a query with citation-oriented results
 *   - web_search         — Search the web for information
 *   - web_search_news    — Search for recent news articles
 *   - search_list_providers — List available search providers
 *
 * @module mcp/search-server
 */

import { createHash } from 'node:crypto';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { listProviders, search } from '@/shared/services/search';
import {
  RESEARCH_TOOL_FLAG,
  isResearchToolEnabled,
} from '@/shared/services/search/feature-flags';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('SearchMCP');

function normalizeSourceDomains(sources?: string[]): string[] | undefined {
  if (!sources || sources.length === 0) return undefined;

  const domains = sources
    .map((source) => {
      const trimmed = source.trim();
      if (!trimmed) return null;
      try {
        return new URL(trimmed).hostname;
      } catch {
        return trimmed
          .replace(/^https?:\/\//i, '')
          .replace(/^www\./i, '')
          .split('/')[0];
      }
    })
    .filter((domain): domain is string => !!domain && domain.includes('.'));

  return domains.length > 0 ? [...new Set(domains)] : undefined;
}

function hashExcerpt(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const searchTools = [
  // ---- Research ----
  tool(
    'research',
    `Research a query using configured search providers. Returns citation-oriented web results suitable for answering user questions with sources.

Use this tool for /search requests, current information, fact verification, product or documentation lookup, and lightweight research tasks.

Depth "quick" returns up to 5 results. Depth "thorough" returns up to 10 results. The optional sources list restricts the search to those domains or URLs when supported by the provider.`,
    {
      query: z.string().describe('Research query'),
      depth: z
        .enum(['quick', 'thorough'])
        .optional()
        .describe('Research depth. Default: quick'),
      sources: z
        .array(z.string())
        .optional()
        .describe(
          'Optional source domains or URLs to restrict results to, e.g. ["docs.python.org", "https://developer.mozilla.org/"]',
        ),
    },
    async ({ query, depth, sources }) => {
      const resolvedDepth = depth ?? 'quick';
      try {
        if (!isResearchToolEnabled()) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Research is disabled. Set ${RESEARCH_TOOL_FLAG}="1" to enable the agent research tool.`,
              },
            ],
            isError: true,
          };
        }

        logger.debug(
          `research called: query="${query}", depth="${resolvedDepth}"`,
        );

        const response = await search({
          query,
          maxResults: resolvedDepth === 'thorough' ? 10 : 5,
          includeDomains: normalizeSourceDomains(sources),
        });

        const lines: string[] = [
          `**Research results for "${query}"**`,
          `Provider: ${response.provider} (${response.latencyMs}ms${response.cached ? ', cached' : ''})`,
          `Depth: ${resolvedDepth}`,
          '',
        ];
        const fetchedAt = new Date().toISOString();

        if (response.answer) {
          lines.push('**Summary:**', response.answer, '');
        }

        if (response.results.length === 0) {
          lines.push('No results found.');
        } else {
          lines.push('**Sources:**');
          for (const [i, r] of response.results.entries()) {
            lines.push(`${i + 1}. **${r.title}**`);
            lines.push(`   URL: ${r.url}`);
            if (r.publishedDate) {
              lines.push(`   Published: ${r.publishedDate}`);
            }
            if (r.snippet) lines.push(`   Snippet: ${r.snippet}`);
            const excerpt = r.content || r.snippet;
            lines.push(
              `   Provenance: fetchedAt=${fetchedAt}; excerptSha256=${hashExcerpt(excerpt)}`,
            );
            lines.push('');
          }
        }

        if (response.citations && response.citations.length > 0) {
          lines.push('**Citations:**');
          for (const citation of response.citations) {
            lines.push(`- ${citation}`);
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        const msg = errorMessage(err);
        logger.error(`research failed: ${msg}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Research failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
  ),

  // ---- Web Search ----
  tool(
    'web_search',
    `Search the web for information. Returns titles, URLs, snippets, and optionally full page content and AI-generated answer summaries.

Use this tool when you need to find current information, verify facts, look up documentation, research topics, or answer questions about recent events.

Returns JSON: { query, results[{ title, url, snippet, content?, score? }], answer?, provider, latencyMs, cached }`,
    {
      query: z.string().describe('The search query'),
      max_results: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe('Maximum number of results to return (1-10). Default: 5'),
      freshness: z
        .enum(['day', 'week', 'month', 'year'])
        .optional()
        .describe('Limit results to a recent time period'),
      country: z
        .string()
        .optional()
        .describe('Country code for regional results (e.g., "US", "CN", "DE")'),
      language: z
        .string()
        .optional()
        .describe('Language code for results (e.g., "en", "zh", "es")'),
      include_domains: z
        .array(z.string())
        .optional()
        .describe(
          'Only search within these domains (e.g., ["docs.python.org", "stackoverflow.com"])',
        ),
      exclude_domains: z
        .array(z.string())
        .optional()
        .describe('Exclude results from these domains'),
    },
    async ({
      query,
      max_results,
      freshness,
      country,
      language,
      include_domains,
      exclude_domains,
    }) => {
      try {
        logger.debug(`web_search called: query="${query}"`);

        const response = await search({
          query,
          maxResults: max_results,
          freshness,
          country,
          language,
          includeDomains: include_domains,
          excludeDomains: exclude_domains,
        });

        // Format results for agent consumption
        const lines: string[] = [
          `**Search results for "${query}"** (via ${response.provider}, ${response.latencyMs}ms${response.cached ? ', cached' : ''})`,
          '',
        ];

        if (response.answer) {
          lines.push('**Answer:**', response.answer, '');
        }

        for (const [i, r] of response.results.entries()) {
          lines.push(`${i + 1}. **${r.title}**`);
          lines.push(`   ${r.url}`);
          if (r.snippet) lines.push(`   ${r.snippet}`);
          if (r.content && r.content.length > r.snippet.length) {
            lines.push(
              `   [Full content available: ${r.content.length} chars]`,
            );
          }
          lines.push('');
        }

        if (response.results.length === 0) {
          lines.push('No results found.');
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        const msg = errorMessage(err);
        logger.error(`web_search failed: ${msg}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Search failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
  ),

  // ---- News Search ----
  tool(
    'web_search_news',
    `Search for recent news articles on a topic. Automatically filters to the past week for freshness.

Returns JSON: { query, results[{ title, url, snippet, publishedDate? }], provider }`,
    {
      query: z.string().describe('The news search query'),
      max_results: z
        .number()
        .min(1)
        .max(10)
        .optional()
        .describe('Maximum number of results (1-10). Default: 5'),
      country: z
        .string()
        .optional()
        .describe('Country code for regional news (e.g., "US", "CN")'),
    },
    async ({ query, max_results, country }) => {
      try {
        logger.debug(`web_search_news called: query="${query}"`);

        const response = await search({
          query,
          maxResults: max_results,
          type: 'news',
          country,
          freshness: 'week',
        });

        const lines: string[] = [
          `**News results for "${query}"** (via ${response.provider})`,
          '',
        ];

        for (const [i, r] of response.results.entries()) {
          lines.push(`${i + 1}. **${r.title}**`);
          lines.push(`   ${r.url}`);
          if (r.publishedDate) lines.push(`   Published: ${r.publishedDate}`);
          if (r.snippet) lines.push(`   ${r.snippet}`);
          lines.push('');
        }

        if (response.results.length === 0) {
          lines.push('No news results found.');
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        const msg = errorMessage(err);
        logger.error(`web_search_news failed: ${msg}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `News search failed: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
  ),

  // ---- List Providers ----
  tool(
    'search_list_providers',
    'List available search providers and their status (enabled, has credentials, priority).',
    {},
    async () => {
      try {
        const providers = listProviders();

        const lines: string[] = ['**Configured search providers:**', ''];

        if (providers.length === 0) {
          lines.push(
            'No search providers configured. Add providers in Settings → Search.',
          );
        } else {
          for (const p of providers) {
            const status = p.enabled
              ? p.hasCredentials
                ? '✓ active'
                : '⚠ missing credentials'
              : '○ disabled';
            lines.push(
              `- **${p.name}** (${p.id}) — ${status}, priority: ${p.priority}`,
            );
          }
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (err) {
        const msg = errorMessage(err);
        return {
          content: [
            { type: 'text' as const, text: `Failed to list providers: ${msg}` },
          ],
          isError: true,
        };
      }
    },
    {
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ),
];

// ============================================================================
// Exports
// ============================================================================

export const SEARCH_TOOL_NAMES = searchTools.map((t) => t.name);

/** Create the Search MCP server instance */
export function createSearchMcpServer() {
  return createSdkMcpServer({
    name: 'search',
    version: '1.0.0',
    tools: searchTools,
  });
}
