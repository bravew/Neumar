import { HttpAgent } from '@ag-ui/client';
import { EventType } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';

import type { AGUIMessage } from '@/components/task/TaskV2MessageBubble.types';
import { toAgentSeedMessages } from '@/shared/lib/message-tree';

/**
 * Activity messages are progress UI, not conversation. Every outbound path
 * must leave them behind: the manual history seed and the AG-UI client's run
 * input, which is what CopilotKit-mediated runs send.
 */
describe('outbound conversation input', () => {
  it('does not seed activity widgets into a new run', () => {
    const messages = [
      { id: 'u1', role: 'user', content: 'Do it' },
      {
        id: 'plan-1',
        role: 'activity',
        activityType: 'plan',
        content: { phase: 'running', goal: 'Ship it', steps: [] },
      },
      { id: 'a1', role: 'assistant', content: 'Done' },
    ] as unknown as AGUIMessage[];

    expect(toAgentSeedMessages(messages)).toEqual([
      { id: 'u1', role: 'user', content: 'Do it' },
      { id: 'a1', role: 'assistant', content: 'Done' },
    ]);
  });

  it('strips activity messages from the AG-UI client run input', async () => {
    let sent: { messages?: Array<{ role?: string; id?: string }> } = {};
    const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;
    const body = [
      { type: EventType.RUN_STARTED, threadId: 't', runId: 'r' },
      { type: EventType.RUN_FINISHED, threadId: 't', runId: 'r' },
    ]
      .map(sse)
      .join('');
    const agent = new HttpAgent({
      url: 'http://localhost/ag-ui',
      threadId: 't',
      fetch: async (_url, init) => {
        sent = JSON.parse(String(init?.body));
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
    });
    agent.addMessage({ id: 'u1', role: 'user', content: 'Do it' } as never);
    agent.addMessage({
      id: 'plan-1',
      role: 'activity',
      activityType: 'plan',
      content: { phase: 'running' },
    } as never);

    await agent.runAgent({ runId: 'r' });

    expect(sent.messages?.map((message) => message.id)).toEqual(['u1']);
  });
});
