#!/usr/bin/env node
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { createLogger } from '@/shared/utils/logger';

import { videoMcpTools } from './tools';

const logger = createLogger('VideoMCP');

const PROJECT_ID_SCHEMA = z.string().min(1);
const SOURCE_ID_SCHEMA = z.string().min(1);
const CUT_PLAN_ID_SCHEMA = z.string().min(1);

export const videoSourceTools = [
  tool(
    'analyze_source',
    'Analyze an imported source video and return cut candidates.',
    {
      project_id: PROJECT_ID_SCHEMA,
      source_id: SOURCE_ID_SCHEMA,
    },
    async (args) => callVideoTool('analyze_source', args),
  ),
  tool(
    'suggest_cuts',
    'Return a draft cut plan from existing source analysis.',
    {
      project_id: PROJECT_ID_SCHEMA,
      source_id: SOURCE_ID_SCHEMA,
    },
    async (args) => callVideoTool('suggest_cuts', args),
  ),
  tool(
    'get_packed_transcript',
    'Read packed word-level transcript context for an analyzed source.',
    {
      project_id: PROJECT_ID_SCHEMA,
      source_id: SOURCE_ID_SCHEMA.optional(),
    },
    async (args) => callVideoTool('get_packed_transcript', args),
  ),
  tool(
    'inspect_source_range',
    'Generate compact source-range evidence with filmstrip, waveform, and word labels.',
    {
      project_id: PROJECT_ID_SCHEMA,
      source_id: SOURCE_ID_SCHEMA,
      start_ms: z.number(),
      end_ms: z.number(),
      frame_count: z.number().optional(),
      waveform_bins: z.number().optional(),
    },
    async (args) => callVideoTool('inspect_source_range', args),
  ),
  tool(
    'apply_cut_plan',
    'Apply an approved source cut plan.',
    {
      project_id: PROJECT_ID_SCHEMA,
      cut_plan_id: CUT_PLAN_ID_SCHEMA,
    },
    async (args) => callVideoTool('apply_cut_plan', args),
  ),
  tool(
    'run_bounded_qa',
    'Render a preview and run core QA with a host-enforced retry cap.',
    {
      project_id: PROJECT_ID_SCHEMA,
      max_iterations: z.number().optional(),
      aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:5']).optional(),
    },
    async (args) => callVideoTool('run_bounded_qa', args),
  ),
];

export function createVideoMcpServer() {
  return createSdkMcpServer({
    name: 'video',
    version: '0.1.0',
    tools: videoSourceTools,
  });
}

export async function startVideoMcpServer(): Promise<void> {
  const server = new Server(
    {
      name: 'neuma-video',
      version: '0.1.0',
    },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: videoMcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = videoMcpTools.find(
      (candidate) => candidate.name === request.params.name,
    );
    if (!tool) {
      return {
        content: [
          { type: 'text', text: `Unknown video tool: ${request.params.name}` },
        ],
        isError: true,
      };
    }
    try {
      const result = await tool.handler(
        (request.params.arguments ?? {}) as Record<string, unknown>,
      );
      return {
        structuredContent: result,
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('video.mcp.tool_failed', {
        tool: tool.name,
        error: message,
      });
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  });

  await server.connect(new StdioServerTransport());
}

async function callVideoTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: [{ type: 'text'; text: string }] }> {
  const toolDefinition = videoMcpTools.find((tool) => tool.name === name);
  if (!toolDefinition) throw new Error(`Unknown video tool: ${name}`);
  const result = await toolDefinition.handler(args);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
}

if (
  process.argv[1]?.endsWith('server.ts') ||
  process.argv.includes('--stdio')
) {
  startVideoMcpServer().catch((error) => {
    logger.error('video.mcp.start_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
