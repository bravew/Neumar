/**
 * Memory MCP Server
 *
 * Exposes 4 tools for agent-driven memory management.
 * Auto-registered when memory is enabled.
 *
 * Uses the tool() helper from claude-agent-sdk (same pattern as media-server.ts).
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  createMemory,
  deleteMemory,
  listEntities,
  listMemories,
  getEntityGraph,
  pinMemory,
  promoteMemories,
  searchMemories,
  storeEmbedding,
  unpinMemory,
} from '@/shared/services/memory';
import type {
  EmbedOptions,
  MemoryCategory,
  ScopeType,
  VisibilityType,
} from '@/shared/services/memory';
import {
  MEMORY_CATEGORIES,
  SCOPE_TYPES,
  VISIBILITY_TYPES,
} from '@/shared/services/memory';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('MemoryMCP');

/** Tool names exported for allowedTools registration in Claude agent */
export const MEMORY_TOOL_NAMES = [
  'memory_recall',
  'memory_store',
  'memory_forget',
  'memory_list',
  'memory_pin',
  'memory_entities',
  'memory_entity_graph',
  'memory_search_keyword',
  'memory_report_drift',
  'memory_journal_distill',
  'memory_promote',
];

export const memoryTools = (embedOptions: EmbedOptions) => [
  // ── memory_recall — semantic search across stored memories ──
  tool(
    'memory_recall',
    `Search long-term memory for relevant context about user preferences, past decisions, or previously discussed topics.
Returns semantically matching memories ranked by relevance.
\nReturns JSON: { results: [{ memory: { id, content, category, importance }, score }] }`,
    {
      query: z
        .string()
        .describe('Search query — can be a question or keywords'),
      limit: z
        .number()
        .min(1)
        .max(20)
        .optional()
        .describe('Max results (default: 5)'),
    },
    async ({ query, limit }) => {
      const results = await searchMemories(query, {
        limit: limit ?? 5,
        embedOptions,
      });

      if (results.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No relevant memories found.' },
          ],
        };
      }

      const text = results
        .map(
          (r, i) =>
            `${i + 1}. [${r.memory.category}] ${r.memory.content} (${Math.round(r.score * 100)}%)`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.length} memories:\n\n${text}`,
          },
        ],
      };
    },
  ),

  // ── memory_store — save information to long-term memory ──
  tool(
    'memory_store',
    `Save important information to long-term memory. Use for preferences, facts, decisions, or anything the user wants remembered.
Automatically deduplicates against existing memories.
Do NOT store: code patterns, file paths, architecture, git history, debugging steps, or task progress — these are derivable from the codebase. Only store the WHY behind decisions, WHO behind preferences, WHERE of external systems.
If the user asks to save a summary or activity log, ask what was surprising or non-obvious — that is the part worth keeping.
\nReturns JSON: { id, content, category, importance, source }`,
    {
      text: z.string().describe('Information to remember'),
      importance: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Importance 0-1 (default: 0.7)'),
      category: z
        .enum(MEMORY_CATEGORIES)
        .optional()
        .describe('Memory category'),
      scope: z
        .enum(SCOPE_TYPES)
        .optional()
        .describe('Memory visibility scope (default: global)'),
      visibility: z
        .enum(VISIBILITY_TYPES)
        .optional()
        .describe('Who can see this memory: private (default) or team'),
    },
    async ({ text, importance, category, scope, visibility }) => {
      // Dedup check
      try {
        const existing = await searchMemories(text, {
          limit: 1,
          threshold: 0.95,
          embedOptions,
        });
        if (existing.length > 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Similar memory already exists: "${existing[0]!.memory.content}"`,
              },
            ],
          };
        }
      } catch {
        // Search may fail before embeddings are available — proceed with store
      }

      const memory = createMemory({
        content: text,
        importance: importance ?? 0.7,
        category: (category as MemoryCategory) ?? 'other',
        source: 'mcp_tool',
        scopeType: (scope as ScopeType) ?? 'global',
        visibility: (visibility ?? 'private') as VisibilityType,
      });

      // Store embedding — await so we can report success/failure accurately
      let embeddingStored = false;
      try {
        await storeEmbedding(memory.id, text, embedOptions);
        embeddingStored = true;
      } catch (err) {
        logger.warn(
          `Failed to store embedding for memory ${memory.id}: ${err}`,
        );
      }

      const suffix = embeddingStored
        ? ''
        : ' (embedding pending — semantic search may not find this memory yet)';
      return {
        content: [
          {
            type: 'text' as const,
            text: `Stored memory: "${text.slice(0, 100)}${text.length > 100 ? '…' : ''}"${suffix}`,
          },
        ],
      };
    },
  ),

  // ── memory_forget — delete a memory by query or ID ──
  tool(
    'memory_forget',
    `Delete a specific memory. Provide either a search query to find the memory, or a specific memory ID.
When using a query, if multiple matches are found, the tool returns candidates for you to pick from.
\nReturns JSON: { deleted: true } or { candidates: [{ id, content }] }`,
    {
      query: z.string().optional().describe('Search to find memory to delete'),
      memoryId: z.string().optional().describe('Specific memory ID to delete'),
    },
    async ({ query, memoryId }) => {
      if (memoryId) {
        deleteMemory(memoryId);
        return {
          content: [
            { type: 'text' as const, text: `Memory ${memoryId} forgotten.` },
          ],
        };
      }

      if (query) {
        const results = await searchMemories(query, {
          limit: 5,
          threshold: 0.7,
          embedOptions,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'No matching memories found.',
              },
            ],
          };
        }

        if (results.length === 1 && results[0]!.score > 0.9) {
          deleteMemory(results[0]!.memory.id);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Forgotten: "${results[0]!.memory.content}"`,
              },
            ],
          };
        }

        const list = results
          .map(
            (r) =>
              `- [${r.memory.id.slice(0, 8)}] ${r.memory.content.slice(0, 60)}…`,
          )
          .join('\n');

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
            },
          ],
        };
      }

      return {
        content: [
          { type: 'text' as const, text: 'Provide query or memoryId.' },
        ],
      };
    },
  ),

  // ── memory_list — list stored memories ──
  tool(
    'memory_list',
    `List stored memories with optional category filter.
\nReturns JSON: { memories: [{ id, content, category, importance, createdAt }] }`,
    {
      category: z.enum(MEMORY_CATEGORIES).optional(),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Max results (default: 10)'),
    },
    async ({ category, limit }) => {
      const memories = listMemories({
        category: category as MemoryCategory | undefined,
        limit: limit ?? 10,
      });

      if (memories.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No memories stored.' }],
        };
      }

      const text = memories
        .map(
          (m, i) =>
            `${i + 1}. [${m.category}] ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `${memories.length} memories:\n\n${text}`,
          },
        ],
      };
    },
  ),

  // ── memory_pin — pin/unpin a memory (v2) ──
  tool(
    'memory_pin',
    `Pin a memory so it never decays, or unpin it to restore decay behavior.
Pinned memories are always included in recall results with a boost.`,
    {
      memoryId: z.string().describe('Memory ID to pin/unpin'),
      unpin: z
        .boolean()
        .optional()
        .describe('Set to true to unpin (default: false = pin)'),
    },
    async ({ memoryId, unpin }) => {
      const result = unpin ? unpinMemory(memoryId) : pinMemory(memoryId);

      if (!result) {
        return {
          content: [
            { type: 'text' as const, text: `Memory ${memoryId} not found.` },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Memory ${unpin ? 'unpinned' : 'pinned'}: "${result.content.slice(0, 60)}..."`,
          },
        ],
      };
    },
  ),

  // ── memory_entities — list known entities (v2) ──
  tool(
    'memory_entities',
    `List known entities (people, projects, technologies) from the memory system.
Returns entities with their types and mention counts.`,
    {
      type: z
        .enum(['person', 'project', 'technology', 'organization', 'concept'])
        .optional()
        .describe('Filter by entity type'),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Max results (default: 10)'),
    },
    async ({ type, limit }) => {
      const entities = listEntities({
        entityType: type as
          | 'person'
          | 'project'
          | 'technology'
          | 'organization'
          | 'concept'
          | undefined,
        limit: limit ?? 10,
      });

      if (entities.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No entities found.' }],
        };
      }

      const text = entities
        .map(
          (e, i) =>
            `${i + 1}. [${e.entityType}] ${e.name}${e.summary ? ` — ${e.summary}` : ''} (mentions: ${e.mentionCount})`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `${entities.length} entities:\n\n${text}`,
          },
        ],
      };
    },
  ),

  // ── memory_entity_graph — explore entity relationships (v2) ──
  tool(
    'memory_entity_graph',
    `Get the relationship graph for a specific entity. Shows connected entities and their relationships.`,
    {
      entity: z.string().describe('Entity name to explore'),
      depth: z
        .number()
        .min(1)
        .max(3)
        .optional()
        .describe('Graph traversal depth (default: 1)'),
    },
    async ({ entity, depth }) => {
      // Find entity by name
      const { findEntityByName } = await import('@/shared/services/memory');
      const found = findEntityByName(entity);

      if (!found) {
        return {
          content: [
            { type: 'text' as const, text: `Entity "${entity}" not found.` },
          ],
        };
      }

      const graph = getEntityGraph(found.id, depth ?? 1);

      const entityList = graph.entities
        .map((e) => `  - [${e.entityType}] ${e.name}`)
        .join('\n');

      const edgeList = graph.edges
        .map((e) => {
          const source = graph.entities.find((n) => n.id === e.sourceEntityId);
          const target = graph.entities.find((n) => n.id === e.targetEntityId);
          return `  - ${source?.name ?? '?'} --[${e.relation}]--> ${target?.name ?? '?'}`;
        })
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `Entity graph for "${found.name}":\n\nEntities:\n${entityList}\n\nRelationships:\n${edgeList || '  (none)'}`,
          },
        ],
      };
    },
  ),

  // ── memory_search_keyword — FTS5 exact keyword search (v3) ──
  tool(
    'memory_search_keyword',
    `Search memories using exact keyword matching (FTS5). Use this when semantic search misses exact tokens, IDs, environment variables, or code symbols.
Returns matched memories ranked by text relevance.`,
    {
      query: z.string().describe('Exact keywords to search for'),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Max results (default: 10)'),
    },
    async ({ query, limit }) => {
      const { ftsOnlySearch } =
        await import('@/shared/services/memory/retriever');
      const results = ftsOnlySearch(query, { limit: limit ?? 10 });

      if (results.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'No keyword matches found.' },
          ],
        };
      }

      const text = results
        .map(
          (r, i) =>
            `${i + 1}. [${r.memory.category}] ${r.memory.content.slice(0, 200)}${r.memory.content.length > 200 ? '...' : ''}`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text' as const,
            text: `${results.length} keyword matches:\n\n${text}`,
          },
        ],
      };
    },
  ),

  // ── memory_report_drift — flag a memory as contradicted by current state (v3) ──
  tool(
    'memory_report_drift',
    `Report that a memory contradicts what you observe in the current codebase or environment. This marks the memory as 'stale' so it will be deprioritized in future recalls. Use this when you verify that a remembered claim is no longer accurate.`,
    {
      memory_id: z.string().describe('The ID of the memory that has drifted'),
      reason: z.string().describe('Brief explanation of the contradiction'),
    },
    async ({ memory_id, reason }) => {
      const { reportDrift } =
        await import('@/shared/services/memory/agent-hooks');
      const success = reportDrift(memory_id, reason);

      return {
        content: [
          {
            type: 'text' as const,
            text: success
              ? `Memory ${memory_id} flagged as drifted: "${reason}"`
              : `Memory ${memory_id} not found or already stale.`,
          },
        ],
      };
    },
  ),

  // ── memory_journal_distill — extract durable memories from session journal (v3) ──
  tool(
    'memory_journal_distill',
    `Distill the current session's journal entries into durable long-term memories. Only available when Journal Mode is enabled. Call this at the end of a session or when the user asks to save session learnings.
Returns the number of new memories created from journal observations.`,
    {
      session_id: z
        .string()
        .describe('The session ID whose journal to distill'),
    },
    async ({ session_id }) => {
      const { getMemoryConfig } =
        await import('@/shared/services/memory/config');
      const config = getMemoryConfig();

      if (!config.journalMode) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Journal mode is not enabled. Enable it in Memory settings to use this tool.',
            },
          ],
        };
      }

      const { getJournalEntryCount } =
        await import('@/shared/services/memory/session-journal');
      const entryCount = getJournalEntryCount(session_id);

      if (entryCount === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No journal entries found for this session.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Session has ${entryCount} journal entries. Journal distillation requires an LLM caller — invoke this from the agent runtime for automatic distillation.`,
          },
        ],
      };
    },
  ),

  // ── memory_promote — consolidate short memories into a durable topic note ──
  tool(
    'memory_promote',
    `Promote several short memories into one durable topic memory. Use this when multiple memories describe the same decision, preference, or workflow and should become a named note in the file-backed memory folder.`,
    {
      title: z.string().describe('Topic title for the promoted memory'),
      memoryIds: z
        .array(z.string())
        .optional()
        .describe('Specific memory IDs to promote'),
      category: z
        .enum(MEMORY_CATEGORIES)
        .optional()
        .describe('Optional category filter when memoryIds are not provided'),
      limit: z
        .number()
        .min(1)
        .max(50)
        .optional()
        .describe('Max memories to promote by importance when filtering'),
    },
    async ({ title, memoryIds, category, limit }) => {
      try {
        const promoted = promoteMemories({
          title,
          memoryIds,
          category: category as MemoryCategory | undefined,
          limit,
        });
        await storeEmbedding(promoted.id, promoted.content, embedOptions).catch(
          (err) => {
            logger.warn(
              `Failed to store embedding for promoted memory ${promoted.id}: ${err}`,
            );
          },
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: `Promoted ${memoryIds?.length ?? limit ?? 'matching'} memories into "${title}" (${promoted.id}).`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: message }],
        };
      }
    },
  ),
];

/**
 * Create the Memory MCP server instance.
 * Called from the Claude agent extension when memory is enabled.
 */
export function createMemoryMcpServer(embedOptions: EmbedOptions) {
  return createSdkMcpServer({
    name: 'memory',
    version: '1.0.0',
    tools: memoryTools(embedOptions),
  });
}
