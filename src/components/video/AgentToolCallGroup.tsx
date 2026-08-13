import { useMemo } from 'react';

import { ToolActivityGroup } from '@/components/shared/chat-panel';
import type { ChatToolCall } from '@/components/shared/chat-panel';
import { useLanguage } from '@/shared/providers/language-provider';

import type { ToolCallRecord } from './useAgentDock';

interface AgentToolCallGroupProps {
  calls: ToolCallRecord[];
}

export function AgentToolCallGroup({ calls }: AgentToolCallGroupProps) {
  const { t } = useLanguage();
  const labels = t.video.editor.agentDock.toolGroup;
  const sharedCalls = useMemo<ChatToolCall[]>(
    () =>
      calls.map((call) => ({
        ...call,
        argsText: JSON.stringify(call.args),
        isError: call.stage === 'error',
      })),
    [calls],
  );

  return <ToolActivityGroup calls={sharedCalls} labels={labels} />;
}
