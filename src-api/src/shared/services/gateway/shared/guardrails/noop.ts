/**
 * Noop Guardrails
 *
 * Pass-through implementation for development/testing.
 */

import type {
  GuardrailContext,
  GuardrailResult,
  GuardrailsProvider,
} from './index';

export class NoopGuardrails implements GuardrailsProvider {
  async check(
    _content: string,
    _context: GuardrailContext,
  ): Promise<GuardrailResult> {
    return { allowed: true, confidence: 1.0 };
  }
}
