/**
 * Webhook Handler
 *
 * Handles incoming webhook requests with bearer token auth,
 * rate limiting, and payload template rendering.
 */

import { timingSafeEqual } from 'node:crypto';

import { createLogger } from '@/shared/utils/logger';

import {
  WEBHOOK_DEFAULT_MAX_BODY_BYTES,
  WEBHOOK_RATE_LIMIT_MAX_FAILURES,
  WEBHOOK_RATE_LIMIT_WINDOW_MS,
} from './constants';
import type { Automation } from './types';

const logger = createLogger('WebhookHandler');

// ============================================================================
// Rate Limiting State
// ============================================================================

interface RateLimitEntry {
  failures: number;
  windowStart: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

// ============================================================================
// Helpers
// ============================================================================

/** Constant-time string comparison to prevent timing attacks on tokens */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Handle an incoming webhook request.
 * Validates bearer token, enforces rate limits, parses body,
 * applies payload template, and enqueues the automation run.
 */
export async function handleWebhook(
  slug: string,
  request: Request,
  lookupAutomation: (slug: string) => Automation | undefined,
  enqueue: (id: string, triggeredBy: string, payload?: unknown) => void,
): Promise<Response> {
  // Look up the automation by webhook slug
  const automation = lookupAutomation(slug);
  if (!automation) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (automation.trigger.type !== 'webhook') {
    return new Response(JSON.stringify({ error: 'Not a webhook automation' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate bearer token
  const authHeader = request.headers.get('Authorization');
  const expectedToken = automation.trigger.webhook.token;
  const providedToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!providedToken || !constantTimeEqual(providedToken, expectedToken)) {
    logger.warn('Webhook auth failed', { slug });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting (by slug as identifier)
  if (isRateLimited(slug)) {
    logger.warn('Webhook rate limited', { slug });
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse body with size check
  const maxBytes =
    automation.trigger.webhook.maxBodyBytes ?? WEBHOOK_DEFAULT_MAX_BODY_BYTES;
  let payload: unknown;

  try {
    const contentLength = request.headers.get('Content-Length');
    if (contentLength && parseInt(contentLength, 10) > maxBytes) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bodyText = await request.text();
    if (Buffer.byteLength(bodyText, 'utf-8') > maxBytes) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Try JSON first, fall back to raw text
    if (bodyText.trim()) {
      try {
        payload = JSON.parse(bodyText);
      } catch {
        payload = bodyText;
      }
    }
  } catch (err) {
    logger.error('Failed to read webhook body:', err);
    recordFailure(slug);
    return new Response(JSON.stringify({ error: 'Bad request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Apply payload template if configured
  const template = automation.trigger.webhook.payloadTemplate;
  let renderedPayload = payload;
  if (template && payload) {
    try {
      const rendered = applyTemplate(template, payload, request.headers);
      renderedPayload = rendered;
    } catch (err) {
      logger.warn('Template rendering failed, using raw payload:', err);
    }
  }

  // Enqueue the run
  try {
    enqueue(automation.id, 'webhook', renderedPayload);
    logger.info('Webhook triggered', { slug, automationId: automation.id });

    return new Response(
      JSON.stringify({ success: true, message: 'Run enqueued' }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  } catch (err) {
    logger.error('Failed to enqueue webhook run:', err);
    recordFailure(slug);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal error',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

/**
 * Apply a template string by replacing {{payload.x.y}} and {{headers.x}} placeholders.
 * Supports: {{payload.path.to.value}}, {{headers.x-header-name}}, {{meta.timestamp}}.
 */
export function applyTemplate(
  template: string,
  payload: unknown,
  headers: Headers,
): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, expr: string) => {
    const trimmed = expr.trim();

    // {{meta.timestamp}}
    if (trimmed === 'meta.timestamp') {
      return new Date().toISOString();
    }

    // {{headers.x-header-name}}
    if (trimmed.startsWith('headers.')) {
      const headerName = trimmed.slice(8);
      return headers.get(headerName) ?? '';
    }

    // {{payload.path.to.value}}
    if (trimmed.startsWith('payload.')) {
      const path = trimmed.slice(8).split('.');
      let current: unknown = payload;
      for (const key of path) {
        if (
          current === null ||
          current === undefined ||
          typeof current !== 'object'
        ) {
          return '';
        }
        current = (current as Record<string, unknown>)[key];
      }
      return current !== null && current !== undefined ? String(current) : '';
    }

    return '';
  });
}

// ============================================================================
// Rate Limiting Internals
// ============================================================================

/**
 * Check if a slug is currently rate-limited.
 */
function isRateLimited(slug: string): boolean {
  const entry = rateLimits.get(slug);
  if (!entry) return false;

  // Reset window if expired
  if (Date.now() - entry.windowStart > WEBHOOK_RATE_LIMIT_WINDOW_MS) {
    rateLimits.delete(slug);
    return false;
  }

  return entry.failures >= WEBHOOK_RATE_LIMIT_MAX_FAILURES;
}

/**
 * Record a failure for rate limiting purposes.
 */
function recordFailure(slug: string): void {
  const entry = rateLimits.get(slug);
  const now = Date.now();

  if (!entry || now - entry.windowStart > WEBHOOK_RATE_LIMIT_WINDOW_MS) {
    rateLimits.set(slug, { failures: 1, windowStart: now });
  } else {
    entry.failures++;
  }
}
