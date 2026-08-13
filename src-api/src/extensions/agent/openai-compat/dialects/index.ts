import type { OpenAICompatDialect } from '@/core/agent/types';

import { kimiK3Dialect } from './kimi-k3';
import { standardDialect } from './standard';
import type { ChatProviderDialect } from './types';

const DIALECTS: Record<OpenAICompatDialect, ChatProviderDialect> = {
  standard: standardDialect,
  'kimi-k3': kimiK3Dialect,
};

export function getChatProviderDialect(
  dialect: OpenAICompatDialect | undefined,
): ChatProviderDialect {
  return DIALECTS[dialect ?? 'standard'];
}

export type {
  ChatProviderDialect,
  ProviderAssistantEnvelope,
  ProviderTurnState,
} from './types';
export { createProviderTurnState, normalizeOpenAIUsage } from './types';
