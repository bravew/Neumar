import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('Guardrails');

export interface GuardrailsProvider {
  check(text: string): Promise<{ allowed: boolean; reason?: string }>;
}

class NoopGuardrails implements GuardrailsProvider {
  async check(): Promise<{ allowed: boolean }> {
    return { allowed: true };
  }
}

class DenyAllGuardrails implements GuardrailsProvider {
  async check(): Promise<{ allowed: boolean; reason: string }> {
    return {
      allowed: false,
      reason: 'Guardrails provider not implemented (failMode=closed)',
    };
  }
}

export function createGuardrails(
  provider: 'none' | 'anthropic' | 'llm-guard',
  failMode: 'open' | 'closed',
): GuardrailsProvider {
  switch (provider) {
    case 'none':
      return new NoopGuardrails();
    case 'anthropic':
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
