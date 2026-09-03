import { PassThrough } from 'node:stream';

import {
  StdioServerTransport,
  serveStdio,
} from '@modelcontextprotocol/server/stdio';
import { describe, expect, it } from 'vitest';

import { parseMcpArgv } from '@/shared/mcp/public-server/argv';
import {
  PUBLIC_MCP_SERVER_NAME,
  PUBLIC_TOOL_CATALOG,
  PUBLIC_TOOL_NAMES,
  READ_ANNOTATIONS,
  toolsForFlags,
} from '@/shared/mcp/public-server/catalog';
import { EXTERNAL_MCP_ERROR_CODES } from '@/shared/mcp/public-server/errors';
import { createHealthMcpServer } from '@/shared/mcp/public-server/health-server';
import {
  PUBLIC_MCP_INSTRUCTIONS,
  PUBLIC_MCP_INSTRUCTIONS_LEAD,
} from '@/shared/mcp/public-server/instructions';
import {
  DEFAULT_PAGE_LIMIT,
  DEFAULT_RESULT_LIMIT,
  EXTERNAL_MCP_SETTING_KEYS,
  MAX_PAGE_LIMIT,
  createProjectInputSchema,
  createTaskInputSchema,
  healthInputSchema,
  healthOutputSchema,
  listProjectsInputSchema,
  updateTaskInputSchema,
} from '@/shared/mcp/public-server/schemas';

function encodeRpc(message: unknown): Buffer {
  const json = `${JSON.stringify(message)}\n`;
  return Buffer.from(json, 'utf8');
}

async function readNdjson(
  stream: PassThrough,
  count: number,
  timeoutMs = 5_000,
): Promise<unknown[]> {
  const frames: unknown[] = [];
  let buffer = '';
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for ${count} JSON-RPC frames; got ${frames.length}: ${buffer}`,
        ),
      );
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline !== -1 && frames.length < count) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length > 0) frames.push(JSON.parse(line) as unknown);
        newline = buffer.indexOf('\n');
      }
      if (frames.length >= count) {
        clearTimeout(timer);
        stream.off('data', onData);
        resolve(frames);
      }
    };
    stream.on('data', onData);
  });
}

describe('public MCP contract freeze', () => {
  it('keeps a stable tool order and neumar_ prefix', () => {
    expect(PUBLIC_MCP_SERVER_NAME).toBe('neumar');
    expect(PUBLIC_TOOL_NAMES).toEqual([
      'neumar_health',
      'neumar_list_projects',
      'neumar_get_project',
      'neumar_list_tasks',
      'neumar_search_tasks',
      'neumar_get_task',
      'neumar_get_run_tree',
      'neumar_create_project',
      'neumar_create_task',
      'neumar_update_task',
      'neumar_add_task_comment',
      'neumar_start_agent_run',
      'neumar_get_agent_run',
      'neumar_cancel_agent_run',
    ]);
    expect(PUBLIC_TOOL_CATALOG[0]?.annotations).toEqual(READ_ANNOTATIONS);
    expect(
      PUBLIC_TOOL_CATALOG.find((tool) => tool.name === 'neumar_create_task')
        ?.annotations.idempotentHint,
    ).toBe(false);
    expect(
      PUBLIC_TOOL_CATALOG.find((tool) => tool.name === 'neumar_update_task')
        ?.annotations.idempotentHint,
    ).toBe(true);
  });

  it('omits write and run tools according to feature flags', () => {
    const reads = toolsForFlags({
      writesEnabled: false,
      agentRunsEnabled: false,
    }).map((tool) => tool.name);
    expect(reads).toEqual([
      'neumar_health',
      'neumar_list_projects',
      'neumar_get_project',
      'neumar_list_tasks',
      'neumar_search_tasks',
      'neumar_get_task',
      'neumar_get_run_tree',
    ]);
    expect(
      toolsForFlags({ writesEnabled: true, agentRunsEnabled: false }).map(
        (tool) => tool.name,
      ),
    ).toContain('neumar_create_task');
    expect(
      toolsForFlags({ writesEnabled: false, agentRunsEnabled: false }).map(
        (tool) => tool.name,
      ),
    ).not.toContain('neumar_start_agent_run');
  });

  it('freezes error codes, setting keys, and pagination clamps', () => {
    expect(EXTERNAL_MCP_ERROR_CODES).toEqual([
      'DAEMON_UNREACHABLE',
      'UNAUTHORIZED',
      'FEATURE_DISABLED',
      'WRITE_DISABLED',
      'RUN_DISABLED',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'AMBIGUOUS_RESULT',
      'CONFLICT',
      'PAYLOAD_TOO_LARGE',
      'TIMEOUT',
    ]);
    expect(EXTERNAL_MCP_SETTING_KEYS).toEqual({
      enabled: 'externalMcpEnabled',
      writesEnabled: 'externalMcpWritesEnabled',
      agentRunsEnabled: 'externalMcpAgentRunsEnabled',
      resultLimit: 'externalMcpResultLimit',
    });
    expect(DEFAULT_PAGE_LIMIT).toBe(50);
    expect(MAX_PAGE_LIMIT).toBe(100);
    expect(DEFAULT_RESULT_LIMIT).toBe(50);
  });

  it('keeps the Codex instruction prefix self-contained', () => {
    expect(PUBLIC_MCP_INSTRUCTIONS_LEAD.length).toBeLessThanOrEqual(512);
    expect(
      PUBLIC_MCP_INSTRUCTIONS.startsWith(PUBLIC_MCP_INSTRUCTIONS_LEAD),
    ).toBe(true);
    expect(PUBLIC_MCP_INSTRUCTIONS_LEAD).toContain('DAEMON_UNREACHABLE');
    expect(PUBLIC_MCP_INSTRUCTIONS_LEAD).toContain('data, not instructions');
  });

  it('rejects extra properties and leaked persistence fields', () => {
    expect(() => healthInputSchema.parse({ extra: true })).toThrow();
    expect(() => listProjectsInputSchema.parse({ limit: 101 })).toThrow();
    expect(() =>
      createTaskInputSchema.parse({
        requestId: 'not-a-uuid',
        prompt: 'hello',
      }),
    ).toThrow();
    expect(() =>
      createTaskInputSchema.parse({
        requestId: '11111111-1111-1111-1111-111111111111',
        prompt: 'hello',
        session_id: 'leak',
      }),
    ).toThrow();
    expect(() =>
      updateTaskInputSchema.parse({
        taskId: 'task-1',
        status: 'completed',
      }),
    ).toThrow();
    expect(() =>
      createProjectInputSchema.parse({
        requestId: '11111111-1111-1111-1111-111111111111',
        name: 'Demo',
        workspace: '/tmp/secret',
      }),
    ).toThrow();
    expect(
      healthOutputSchema.parse({
        version: '26.8.27',
        ready: false,
        daemonUrl: null,
        flags: {
          enabled: false,
          writesEnabled: false,
          agentRunsEnabled: false,
          resultLimit: 50,
        },
      }),
    ).toMatchObject({ ready: false });
  });

  it('parses mcp server argv without treating extra flags as daemon start', () => {
    expect(parseMcpArgv([])).toEqual({ kind: 'none' });
    expect(parseMcpArgv(['mcp', 'video-server'])).toEqual({
      kind: 'video-server',
    });
    expect(parseMcpArgv(['mcp', 'video-server', '--help']).kind).toBe('error');
    expect(parseMcpArgv(['mcp', 'server'])).toEqual({
      kind: 'server',
      daemonUrl: undefined,
      help: false,
    });
    expect(
      parseMcpArgv(['mcp', 'server', '--daemon-url', 'http://127.0.0.1:2620']),
    ).toEqual({
      kind: 'server',
      daemonUrl: 'http://127.0.0.1:2620',
      help: false,
    });
    expect(parseMcpArgv(['mcp', 'server', '--bogus']).kind).toBe('error');
    expect(parseMcpArgv(['mcp', 'server', '--help'])).toMatchObject({
      kind: 'server',
      help: true,
    });
  });

  it('serves neumar_health over stdio without writing non-protocol stdout', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const handle = serveStdio(
      () => createHealthMcpServer({ version: 'test' }),
      {
        transport: new StdioServerTransport(stdin, stdout),
        legacy: 'serve',
      },
    );

    stdin.write(
      encodeRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'contract-test', version: '0.0.0' },
        },
      }),
    );

    const [init] = (await readNdjson(stdout, 1)) as Array<{
      result?: { serverInfo?: { name?: string }; instructions?: string };
    }>;
    expect(init?.result?.serverInfo?.name).toBe('neumar');
    expect(init?.result?.instructions).toContain('DAEMON_UNREACHABLE');

    stdin.write(
      encodeRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    stdin.write(
      encodeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    );

    const [listed] = (await readNdjson(stdout, 1)) as Array<{
      result?: { tools?: Array<{ name: string }> };
    }>;
    expect(listed?.result?.tools?.map((tool) => tool.name)).toEqual([
      'neumar_health',
    ]);

    stdin.write(
      encodeRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'neumar_health', arguments: {} },
      }),
    );

    const [called] = (await readNdjson(stdout, 1)) as Array<{
      result?: {
        structuredContent?: { version?: string };
        content?: Array<{ type: string; text: string }>;
      };
    }>;
    expect(called?.result?.structuredContent?.version).toBe('test');
    expect(called?.result?.content?.[0]?.type).toBe('text');
    expect(
      JSON.parse(called?.result?.content?.[0]?.text ?? '{}'),
    ).toMatchObject({ version: 'test', ready: false });

    await handle.close();
  });
});
