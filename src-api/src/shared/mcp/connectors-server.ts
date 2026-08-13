/**
 * Connectors MCP Server
 *
 * Exposes Composio (and future) connector tools to the Claude agent.
 * Uses the meta-tool pattern from the open-design sample:
 *   - `connectors_list` lets the agent discover which connectors are
 *     connected and what read tools they advertise without flooding the
 *     tool list with hundreds of entries.
 *   - `connectors_execute` runs a specific tool through the binder, which
 *     enforces tier/scope/approval policy and routes to Composio.
 *
 * @module mcp/connectors-server
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import {
  executeConnectorTool,
  materializeConnectorToolEntries,
  type BinderRunContext,
} from '@/shared/connectors/binder';
import { getComposioProvider } from '@/shared/connectors/providers/composio';
import { errorMessage } from '@/shared/utils/errors';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ConnectorsMCP');

const MAX_PAYLOAD_BYTES = 200_000;

/**
 * Connectors handled by a dedicated first-party MCP server (e.g. Box has
 * `mcp__box__*`). These are filtered out of `connectors_list` so the agent
 * sees one canonical path to each provider — the first-party tools — and
 * never tries to reach Box/Dropbox/OneDrive through the generic
 * `connectors_execute` shim.
 */
const FIRST_PARTY_CONNECTOR_IDS = new Set<string>([
  'box',
  'dropbox',
  'onedrive',
]);

export interface ConnectorMcpContext {
  buildContext: () => BinderRunContext;
}

function summarizeOutput(output: unknown): unknown {
  const json = JSON.stringify(output);
  if (json.length <= MAX_PAYLOAD_BYTES) return output;
  return {
    truncated: true,
    note: `Output (${json.length} bytes) exceeded ${MAX_PAYLOAD_BYTES} bytes — only the first slice is shown.`,
    preview: json.slice(0, MAX_PAYLOAD_BYTES),
  };
}

export function buildConnectorsTools(ctx: ConnectorMcpContext) {
  return [
    tool(
      'connectors_list',
      `List connected third-party connectors (Box, GitHub, Slack, Notion, …) and the curated tools the user has authorized for each.

Call this BEFORE asking the user about an external service to confirm whether they have already connected it. Returns one entry per connected connector with its id, name, category, account label, and a curated short list of read-safe tools (typically 5–10 per connector) the agent may invoke via connectors_execute.

By default the list is curated to keep the response small; pass \`includeAll: true\` to receive the full hundreds-of-tools surface when you need a less common operation. Disconnected and disabled connectors are omitted.`,
      {
        connectorId: z
          .string()
          .optional()
          .describe('Optional. Restrict the list to one connector id.'),
        includeAll: z
          .boolean()
          .optional()
          .describe(
            'When true, return every advertised tool for each connector instead of the curated short list. Use only when the curated set lacks the operation you need.',
          ),
      },
      async (input) => {
        try {
          const provider = getComposioProvider();
          const connected = provider.getConnectedConnectorIds();
          const filtered = [...connected].filter((id) => {
            if (input.connectorId) return id === input.connectorId;
            // Hide connectors that have a dedicated first-party MCP server
            // unless the caller explicitly asked for one by id.
            return !FIRST_PARTY_CONNECTOR_IDS.has(id);
          });
          const context = ctx.buildContext();

          const entries: Array<Record<string, unknown>> = [];
          for (const id of filtered) {
            try {
              const detail = await provider.getDetail(id, context.abortSignal);
              const materialized = materializeConnectorToolEntries({
                catalog: [detail],
                context,
              });
              const curated = new Set(detail.curatedToolNames ?? []);
              const featured = new Set(detail.featuredToolNames ?? []);
              const visibleEntries =
                input.includeAll || curated.size === 0
                  ? materialized
                  : materialized.filter(({ tool: t }) => curated.has(t.name));
              entries.push({
                id: detail.id,
                name: detail.name,
                category: detail.category,
                provider: detail.provider,
                accountLabel: detail.accountLabel,
                tools: visibleEntries
                  .slice(0, 50)
                  .sort((a, b) => {
                    const aFeatured = featured.has(a.tool.name) ? 0 : 1;
                    const bFeatured = featured.has(b.tool.name) ? 0 : 1;
                    return aFeatured - bFeatured;
                  })
                  .map(({ tool: t, decision }) => ({
                    name: t.name,
                    title: t.title,
                    description: t.description,
                    sideEffect: t.safety.sideEffect,
                    approval: decision.approval,
                    featured: featured.has(t.name) || undefined,
                  })),
                toolCount: visibleEntries.length,
                totalToolCount: materialized.length,
                curated: !input.includeAll && curated.size > 0,
              });
            } catch (err) {
              logger.warn('connector list entry failed', {
                connectorId: id,
                error: errorMessage(err),
              });
            }
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ connectors: entries }, null, 2),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `connectors_list failed: ${errorMessage(err)}`,
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
          openWorldHint: false,
        },
      },
    ),
    tool(
      'connectors_execute',
      `Run a specific connector tool returned by connectors_list. The connectorId and toolName must come from connectors_list output. The input object's keys must match that tool's input schema.

Write-side tools may require user confirmation per the connector's approval policy; the binder will refuse and return an error if the current run is not allowed to execute the tool. Tier and scope rules apply.`,
      {
        connectorId: z
          .string()
          .describe('Connector id, e.g. "box", "github", "slack".'),
        toolName: z
          .string()
          .describe(
            'Tool name as listed by connectors_list (already namespaced, e.g. "box.BOX_LIST_ITEMS_IN_FOLDER").',
          ),
        input: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Tool input object matching the tool schema.'),
      },
      async (input) => {
        try {
          const context = ctx.buildContext();
          const result = await executeConnectorTool({
            connectorId: input.connectorId,
            toolName: input.toolName,
            input: input.input ?? {},
            context,
          });
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    output: summarizeOutput(result.output),
                    truncated: result.truncated,
                    logId: result.logId,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: 'text',
                text: `connectors_execute failed: ${errorMessage(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    ),
  ];
}

export const CONNECTORS_TOOL_NAMES = [
  'connectors_list',
  'connectors_execute',
] as const;

/** Create the Connectors MCP server bound to a specific run context. */
export function createConnectorsMcpServer(ctx: ConnectorMcpContext) {
  return createSdkMcpServer({
    name: 'connectors',
    version: '1.0.0',
    tools: buildConnectorsTools(ctx),
  });
}
