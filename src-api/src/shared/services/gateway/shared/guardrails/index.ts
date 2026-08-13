/**
 * Guardrails Provider
 *
 * Content safety checking interface. Defaults to noop for development.
 */

import { createLogger } from '@/shared/utils/logger';

import { NoopGuardrails } from './noop';

const logger = createLogger('Guardrails');

export interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  category?: 'prompt_injection' | 'pii' | 'harmful_content' | 'policy';
  confidence: number;
}

export interface GuardrailContext {
  channelId: string;
  senderId: string;
  sessionId?: string;
}

export interface GuardrailsProvider {
  check(content: string, context: GuardrailContext): Promise<GuardrailResult>;
}

/**
 * Load a guardrails provider. When `failMode` is 'closed', unimplemented
 * providers will deny all messages by default instead of allowing them.
 */
export function loadGuardrailsProvider(
  provider: string,
  failMode: 'open' | 'closed',
): GuardrailsProvider {
  switch (provider) {
    case 'none':
      return new NoopGuardrails();
    case 'anthropic':
      // Future: Anthropic guardrails API integration
      logger.warn(
        `Anthropic guardrails not yet implemented, failMode=${failMode}`,
      );
      return failMode === 'closed'
        ? new DenyAllGuardrails()
        : new NoopGuardrails();
    case 'llm-guard':
      logger.warn(`LLM Guard not yet implemented, failMode=${failMode}`);
      return failMode === 'closed'
        ? new DenyAllGuardrails()
        : new NoopGuardrails();
    default:
      logger.warn(
        `Unknown guardrails provider '${provider}', failMode=${failMode}`,
      );
      return failMode === 'closed'
        ? new DenyAllGuardrails()
        : new NoopGuardrails();
  }
}

class DenyAllGuardrails implements GuardrailsProvider {
  async check(): Promise<GuardrailResult> {
    return {
      allowed: false,
      reason: 'Guardrails provider not implemented (failMode=closed)',
      confidence: 1,
    };
  }
}
