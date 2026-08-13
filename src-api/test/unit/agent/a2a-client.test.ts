import { describe, expect, it } from 'vitest';

import { parseA2ASseChunk } from '@/extensions/agent/a2a/client';
import { A2ATaskState } from '@/extensions/agent/a2a/types';

function statusEvent(id = 'task-1') {
  return {
    type: 'status',
    task: {
      id,
      status: {
        state: A2ATaskState.WORKING,
        timestamp: '2026-06-05T00:00:00.000Z',
      },
    },
  };
}

function sseDataBlock(data: string): string {
  return `${data
    .split('\n')
    .map((line) => `data: ${line}`)
    .join('\n')}\n\n`;
}

describe('A2A SSE parsing', () => {
  it('parses multiline data frames', () => {
    const event = statusEvent();
    const parsed = parseA2ASseChunk(
      sseDataBlock(JSON.stringify(event, null, 2)),
    );

    expect(parsed.events).toEqual([event]);
    expect(parsed.rest).toBe('');
    expect(parsed.done).toBe(false);
  });

  it('ignores startup noise and comments before data frames', () => {
    const event = statusEvent('task-noise');
    const parsed = parseA2ASseChunk(
      [
        ': connected',
        '',
        'event: ready',
        '',
        sseDataBlock(JSON.stringify(event)),
      ].join('\n'),
    );

    expect(parsed.events).toEqual([event]);
    expect(parsed.malformedData).toEqual([]);
  });

  it('buffers partial frames until a complete block arrives', () => {
    const event = statusEvent('task-buffered');
    const first = parseA2ASseChunk('data: {"type":"status"');

    expect(first.events).toEqual([]);
    expect(first.rest).toBe('data: {"type":"status"');

    const second = parseA2ASseChunk(
      `${first.rest},"task":${JSON.stringify(event.task)}}\n\n`,
    );

    expect(second.events).toEqual([event]);
    expect(second.rest).toBe('');
  });

  it('flushes a trailing frame without a blank terminator', () => {
    const event = statusEvent('task-tail');
    const parsed = parseA2ASseChunk(`data: ${JSON.stringify(event)}`, {
      flush: true,
    });

    expect(parsed.events).toEqual([event]);
    expect(parsed.rest).toBe('');
  });

  it('stops at DONE frames and reports malformed frames safely', () => {
    const parsed = parseA2ASseChunk(
      ['data: {not json}', '', 'data: [DONE]', '', sseDataBlock('{}')].join(
        '\n',
      ),
    );

    expect(parsed.events).toEqual([]);
    expect(parsed.malformedData).toEqual(['{not json}']);
    expect(parsed.done).toBe(true);
    expect(parsed.rest).toBe('');
  });
});
