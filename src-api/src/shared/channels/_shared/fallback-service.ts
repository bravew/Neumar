import crypto from 'crypto';

import { createLogger } from '@/shared/utils/logger';

import {
  classifyProviderError,
  type ProviderError,
  type ProviderErrorContext,
} from './errors';
import { buildPlainTextFallback } from './fallback-templates';

export interface FallbackDiagnostic {
  id: string;
  provider: string;
  operation?: string;
  errorClass: ProviderError['class'];
  primaryMessage: string;
  fallbackMessage?: string;
  originalLength: number;
  fallbackLength?: number;
  succeeded: boolean;
  createdAt: string;
}

export interface FallbackDeliveryInput<T> {
  content: string;
  context: ProviderErrorContext;
  sendPrimary: () => Promise<T>;
  sendFallback: (content: string) => Promise<T>;
  fallbackMaxLength?: number;
}

const DEFAULT_MAX_DIAGNOSTICS = 100;
const logger = createLogger('ChannelFallbackService');
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const TOKEN_RE = /\b(?:xox[baprs]-|bot)[A-Za-z0-9._-]{8,}\b/g;

function scrubDiagnosticText(text: string): string {
  return text
    .replace(EMAIL_RE, '[redacted-email]')
    .replace(TOKEN_RE, '[redacted-token]');
}

export class ChannelFallbackService {
  private readonly diagnostics: FallbackDiagnostic[] = [];

  constructor(private readonly maxDiagnostics = DEFAULT_MAX_DIAGNOSTICS) {}

  async deliverWithFallback<T>(input: FallbackDeliveryInput<T>): Promise<T> {
    try {
      return await input.sendPrimary();
    } catch (primaryError) {
      const classified = classifyProviderError(primaryError, input.context);
      const fallback = buildPlainTextFallback({
        content: input.content,
        error: classified,
        maxLength: input.fallbackMaxLength,
      });
      try {
        const result = await input.sendFallback(fallback);
        this.record({
          context: input.context,
          error: classified,
          fallback,
          originalLength: input.content.length,
          succeeded: true,
        });
        return result;
      } catch (fallbackError) {
        const fallbackClassified = classifyProviderError(
          fallbackError,
          input.context,
        );
        this.record({
          context: input.context,
          error: classified,
          fallback,
          fallbackError: fallbackClassified,
          originalLength: input.content.length,
          succeeded: false,
        });
        logger.warn('Fallback delivery failed', {
          provider: input.context.provider,
          operation: input.context.operation,
          primaryClass: classified.class,
          fallbackClass: fallbackClassified.class,
        });
        throw fallbackError;
      }
    }
  }

  listDiagnostics(): FallbackDiagnostic[] {
    return [...this.diagnostics];
  }

  clearDiagnostics(): void {
    this.diagnostics.length = 0;
  }

  private record(input: {
    context: ProviderErrorContext;
    error: ProviderError;
    fallback: string;
    fallbackError?: ProviderError;
    originalLength: number;
    succeeded: boolean;
  }): void {
    this.diagnostics.push({
      id: crypto.randomUUID(),
      provider: input.context.provider,
      operation: input.context.operation,
      errorClass: input.error.class,
      primaryMessage: scrubDiagnosticText(input.error.message),
      fallbackMessage: input.fallbackError
        ? scrubDiagnosticText(input.fallbackError.message)
        : undefined,
      originalLength: input.originalLength,
      fallbackLength: input.fallback.length,
      succeeded: input.succeeded,
      createdAt: new Date().toISOString(),
    });
    while (this.diagnostics.length > this.maxDiagnostics) {
      this.diagnostics.shift();
    }
  }
}

export const channelFallbackService = new ChannelFallbackService();
