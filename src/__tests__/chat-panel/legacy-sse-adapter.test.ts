import { describe, expect, it } from 'vitest';

import {
  normalizeLegacySseFrame,
  normalizeLegacySseFrames,
} from '@/components/shared/chat-panel';

const now = () => '2026-06-14T00:00:00.000Z';
const createId = (prefix: string) => `${prefix}:id`;

describe('chat-panel legacy SSE adapter', () => {
  it('maps legacy message and error frames into text messages', () => {
    const messages = normalizeLegacySseFrames(
      [
        { event: 'message', data: JSON.stringify({ content: 'Hello' }) },
        { event: 'error', data: JSON.stringify({ message: 'Nope' }) },
      ],
      { now, createId },
    );

    expect(messages).toMatchObject([
      { kind: 'text', role: 'assistant', content: 'Hello' },
      { kind: 'text', role: 'system', content: 'Nope', isError: true },
    ]);
  });

  it('maps legacy action and permission frames into action messages', () => {
    const action = normalizeLegacySseFrame(
      {
        event: 'action',
        data: JSON.stringify({
          id: 'action-1',
          name: 'applyTimelineOp',
          summary: 'Move clip',
          args: { clipId: 'clip-1' },
          requiresApproval: true,
        }),
      },
      { now, createId },
    );
    const permission = normalizeLegacySseFrame(
      {
        event: 'permission_request',
        data: JSON.stringify({
          permission: {
            id: 'permission-1',
            tool: 'applyTimelineOp',
            command: '{"clipId":"clip-1"}',
            description: 'Move clip',
          },
        }),
      },
      { now, createId },
    );

    expect(action).toMatchObject({
      kind: 'action',
      action: { id: 'action-1', name: 'applyTimelineOp' },
    });
    expect(permission).toMatchObject({
      kind: 'action',
      action: {
        id: 'permission-1',
        name: 'applyTimelineOp',
        args: { clipId: 'clip-1' },
        requiresApproval: true,
      },
    });
  });
});
