import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ExternalMcpError } from '@/shared/mcp/public-server/errors';
import { withIdempotencyAsync } from '@/shared/services/external-mcp/idempotency';

describe('withIdempotencyAsync', () => {
  it('reserves the request id so a concurrent caller does not run twice', async () => {
    const requestId = randomUUID();
    let starts = 0;
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });

    const first = withIdempotencyAsync(
      'start_agent_run',
      requestId,
      { taskId: 'task-a' },
      async () => {
        starts += 1;
        entered();
        await gate;
        return { runId: 'run-1' };
      },
    );
    await started;
    await expect(
      withIdempotencyAsync(
        'start_agent_run',
        requestId,
        { taskId: 'task-a' },
        async () => {
          starts += 1;
          return { runId: 'run-2' };
        },
      ),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      message: expect.stringMatching(/in progress/i),
    });
    release();
    await expect(first).resolves.toEqual({ runId: 'run-1' });
    expect(starts).toBe(1);

    await expect(
      withIdempotencyAsync(
        'start_agent_run',
        requestId,
        { taskId: 'task-a' },
        async () => {
          starts += 1;
          return { runId: 'run-3' };
        },
      ),
    ).resolves.toEqual({ runId: 'run-1' });
    expect(starts).toBe(1);
  });

  it('clears a failed reservation so the request id can be retried', async () => {
    const requestId = randomUUID();
    await expect(
      withIdempotencyAsync('start_agent_run', requestId, { n: 1 }, async () => {
        throw new ExternalMcpError('VALIDATION_FAILED', 'boom');
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await expect(
      withIdempotencyAsync('start_agent_run', requestId, { n: 1 }, async () => {
        return { ok: true };
      }),
    ).resolves.toEqual({ ok: true });
  });
});
