import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createDaemonClient } from '@/shared/mcp/public-server/daemon-client';
import { ExternalMcpError } from '@/shared/mcp/public-server/errors';
import { toolHttpMapping } from '@/shared/mcp/public-server/handlers';

describe('public MCP write tools', () => {
  it('does not mark write mappings as retryable', () => {
    expect(toolHttpMapping('neumar_create_project')?.retryable).toBe(false);
    expect(toolHttpMapping('neumar_create_task')?.retryable).toBe(false);
    expect(toolHttpMapping('neumar_update_task')?.retryable).toBe(false);
    expect(toolHttpMapping('neumar_add_task_comment')?.retryable).toBe(false);
    expect(toolHttpMapping('neumar_list_projects')?.retryable).toBe(true);
  });

  it('refreshes discovery but does not replay a failed write', async () => {
    let writes = 0;
    const client = createDaemonClient({
      initialUrl: 'http://127.0.0.1:5126',
      readSecret: () => 'secret',
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith('/projects') && !url.includes('?')) {
          writes += 1;
          throw new Error('connect ECONNREFUSED');
        }
        throw new Error(`unexpected ${url}`);
      },
    });

    await expect(
      client.call('neumar_create_project', {
        requestId: randomUUID(),
        name: 'Nope',
      }),
    ).rejects.toMatchObject({ code: 'DAEMON_UNREACHABLE' });
    expect(writes).toBe(1);
  });

  it('does not retry WRITE_DISABLED', async () => {
    let hits = 0;
    const client = createDaemonClient({
      initialUrl: 'http://127.0.0.1:5126',
      readSecret: () => 'secret',
      fetchImpl: async () => {
        hits += 1;
        return new Response(
          JSON.stringify({
            code: 'WRITE_DISABLED',
            message: 'writes off',
            retryable: false,
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    await expect(
      client.call('neumar_create_project', {
        requestId: randomUUID(),
        name: 'Blocked',
      }),
    ).rejects.toBeInstanceOf(ExternalMcpError);
    expect(hits).toBe(1);
  });
});
