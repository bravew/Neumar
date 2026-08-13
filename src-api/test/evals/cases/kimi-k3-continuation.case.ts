import { kimiK3Dialect } from '@/extensions/agent/openai-compat/dialects/kimi-k3';
import { createProviderTurnState } from '@/extensions/agent/openai-compat/dialects/types';

import type { EvalCase } from '../types';

const evalCase: EvalCase = {
  id: 'kimi-k3-continuation',
  name: 'Kimi K3 preserves reasoning across a tool continuation',
  tier: 'gate',
  touchfiles: [
    'src-api/src/extensions/agent/openai-compat/**',
    'src-api/src/shared/db/provider-conversation-state.ts',
  ],
  budget: { maxUsd: 0, timeoutMs: 5_000 },
  run() {
    const state = createProviderTurnState();
    kimiK3Dialect.consumeDelta(
      {
        reasoning_content: 'inspect repository',
        tool_calls: [
          {
            index: 0,
            id: 'call-1',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          },
        ],
      },
      state,
    );
    const envelope = kimiK3Dialect.buildAssistantEnvelope(state);
    const passed =
      envelope.reasoning_content === 'inspect repository' &&
      envelope.tool_calls?.[0]?.function.arguments === '{"path":"a.ts"}';
    return {
      passed,
      score: passed ? 1 : 0,
      notes: passed
        ? 'Exact reasoning and tool envelope retained'
        : 'Provider envelope lost continuation state',
      metrics: { toolCalls: envelope.tool_calls?.length ?? 0 },
    };
  },
};

export default evalCase;
