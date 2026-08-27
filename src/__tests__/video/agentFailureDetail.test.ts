import { describe, expect, it } from 'vitest';

import { latestAgentFailureDetail } from '@/components/video/agentFailureDetail';
import type { AgentDockMessage } from '@/components/video/useAgentDock';

describe('latestAgentFailureDetail', () => {
  it('extracts the latest failed tool message from a structured result', () => {
    const messages: AgentDockMessage[] = [
      {
        id: 'tool-1',
        role: 'assistant',
        kind: 'tool',
        call: {
          id: 'call-1',
          name: 'video_approve_storyboard',
          args: {},
          stage: 'error',
          result: JSON.stringify({
            code: 'VIDEO_TOOL_ERROR',
            message: 'Storyboard exceeds template duration limit',
          }),
        },
        createdAt: '2026-08-26T20:19:00.000Z',
      },
    ];

    expect(latestAgentFailureDetail(messages)).toBe(
      'video_approve_storyboard: Storyboard exceeds template duration limit',
    );
  });

  it('does not report successful tool calls as failures', () => {
    const messages: AgentDockMessage[] = [
      {
        id: 'tool-1',
        role: 'assistant',
        kind: 'tool',
        call: {
          id: 'call-1',
          name: 'video_get_project_summary',
          args: {},
          stage: 'complete',
          result: '{}',
        },
        createdAt: '2026-08-26T20:19:00.000Z',
      },
    ];

    expect(latestAgentFailureDetail(messages)).toBeUndefined();
  });
});
