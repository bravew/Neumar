/**
 * Workspace MCP Server
 *
 * Exposes RAG over the user's workspace as MCP tools so agents can search
 * the codebase semantically before falling back to Glob/Grep/Read. Surfaces:
 *   - workspace_search — hybrid (FTS5 + vector + MMR) chunk retrieval
 *   - workspace_open   — read a workspace file (or line range) with safety
 *   - workspace_index_status — last-run stats for diagnostics / surfacing in UI
 *
 * Auto-registered alongside the memory MCP server. Path arguments are scoped
 * to the workspace root — traversal outside the root is rejected.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  getIndexSummary,
  openWorkspaceFile,
  searchWorkspace,
} from '@/shared/services/rag';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('WorkspaceMCP');

export const WORKSPACE_TOOL_NAMES = [
  'workspace_search',
  'workspace_open',
  'workspace_index_status',
];

export const workspaceTools = () => [
  tool(
    'workspace_search',
    `Search the user's workspace for code or text relevant to a query.
Returns ranked snippets from indexed source files using hybrid lexical + semantic retrieval.
Prefer this over Glob/Grep when looking for "where is X implemented" or "files mentioning Y" — it is faster and ranks by relevance.

Returns: list of { path, startLine, endLine, symbol, score, source } with the matching content.`,
    {
      query: z.string().describe('Natural-language or keyword query'),
      limit: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe('Max results (default: 8)'),
      pathFilter: z
        .string()
        .optional()
        .describe(
          'Optional substring to constrain results to matching paths (e.g. "src/api")',
        ),
    },
    async ({ query, limit, pathFilter }) => {
      try {
        const results = await searchWorkspace(query, {
          limit: limit ?? 8,
          pathFilter,
        });
        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No matching chunks indexed. The workspace index may be empty — run a reindex from Memory settings.',
              },
            ],
          };
        }
        const text = results
          .map((r, i) => {
            const header = `${i + 1}. ${r.chunk.path}:${r.chunk.startLine}-${
              r.chunk.endLine
            } [${r.source} · ${r.score.toFixed(3)}]${
              r.chunk.symbol ? ` (${r.chunk.symbol})` : ''
            }`;
            return `${header}\n${r.chunk.content}`;
          })
          .join('\n\n---\n\n');
        return {
          content: [{ type: 'text' as const, text }],
        };
      } catch (err) {
        logger.warn(`workspace_search failed: ${err}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Workspace search failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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

  tool(
    'workspace_open',
    `Read a file from the user's workspace, optionally restricted to a line range.
Use after workspace_search to pull the surrounding context for a specific hit.
Path is relative to the workspace root and may not escape it.`,
    {
      path: z.string().describe('Workspace-relative path'),
      startLine: z.number().min(1).optional(),
      endLine: z.number().min(1).optional(),
      maxChars: z
        .number()
        .min(100)
        .max(50_000)
        .optional()
        .describe('Hard cap on returned characters (default 12000)'),
    },
    async ({ path, startLine, endLine, maxChars }) => {
      try {
        const lines =
          startLine && endLine && endLine >= startLine
            ? { start: startLine, end: endLine }
            : undefined;
        const result = await openWorkspaceFile(path, { lines, maxChars });
        const truncated = result.truncated ? '\n\n[...truncated]' : '';
        return {
          content: [
            {
              type: 'text' as const,
              text: `// ${result.path}${lines ? `:${lines.start}-${lines.end}` : ''}\n${result.content}${truncated}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to open ${path}: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
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

  tool(
    'workspace_index_status',
    `Report the size and freshness of the workspace search index.
Use this when workspace_search returns no results to decide whether the user needs to reindex.`,
    {},
    async () => {
      const summary = getIndexSummary();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
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

export function createWorkspaceMcpServer() {
  return createSdkMcpServer({
    name: 'workspace',
    version: '1.0.0',
    tools: workspaceTools(),
  });
}
